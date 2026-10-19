import { groundFloorOf } from '@house-scanner-tools/floor';
import {
  area,
  MAX_HTML_CHARS,
  type MorePages,
  numberOf,
  type PageRead,
  positionPrecision,
  positiveInt,
  type ReadContext,
} from '@house-scanner-tools/page-read';
import {
  finishViewings,
  viewingFromLabelledWallClock,
} from '@house-scanner-tools/viewing-time';
import {
  type Observation,
  observationSchema,
} from '@/features/house-scanner/types/contracts';

// Field meanings come from a structure-only look at the JSON the site's own pages load from
// api.husmanhagberg.se/object/api/objects on 17 October 2026: { estates, count }, 143 homes in one answer
// for a text search on Göteborg. The route is not documented as public. Items marked "inferred" were not proven.

type Facts = Observation['facts'];
type Rec = Record<string, unknown>;
const isRecord = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const record = (value: unknown): Rec => (isRecord(value) ? value : {});
const text = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const OBJECT_REF = /^[A-Za-z0-9_]{3,40}$/;
// One of the thumbnails the answer lists, on the broker image host: /images/<folder>/<image id>-<w>x<h>.jpg.
const IMAGE_PATH =
  /^\/images\/[A-Za-z0-9]{1,20}\/[A-Za-z0-9]{1,40}-\d{2,4}x\d{2,4}\.jpg$/;
const IMAGE_ORIGIN = 'https://media.husmanhagberg.se';
// The daily run refreshes the photo, so a week is ample before the app stops showing it.
const PHOTO_VALID_MS = 7 * 24 * 60 * 60 * 1000;

// HousingCooperative is the tenant-owner apartment type. House covers villas and terraced houses seen in the
// details; its tenure is not stated. Holiday homes, commercial property and anything else are skipped.
function typeOf(type: unknown) {
  if (type === 'HousingCooperative')
    return {
      propertyType: 'apartment' as const,
      tenure: 'cooperative' as const,
    };
  if (type === 'House')
    return { propertyType: 'house' as const, tenure: 'unknown' as const };
  return null;
}

// ForSale is on the market. TakenIn with showAsComing true is the site's coming-soon view (inferred); taken in
// and not shown is not public, and every other status is skipped.
function statusOf(item: Rec): Facts['status'] | null {
  const { statusId, showAsComing } = item;
  if (
    showAsComing === true &&
    (statusId === 'TakenIn' || statusId === 'ForSale')
  )
    return 'upcoming';
  return statusId === 'ForSale' && showAsComing !== true ? 'available' : null;
}

function photoFrom(item: Rec, observedAt: string) {
  const thumb = record(item.thumb);
  const url = text(record(thumb.list2x).url) || text(record(thumb.list).url);
  try {
    const parsed = new URL(url);
    if (
      parsed.origin !== IMAGE_ORIGIN ||
      parsed.search !== '' ||
      !IMAGE_PATH.test(parsed.pathname)
    )
      return null;
  } catch {
    return null;
  }
  return {
    url,
    attribution: 'Husman Hagberg',
    rightsBasis:
      'Shown to the household owner for personal use, loaded from the broker image host and never copied or stored.',
    expiresAt: new Date(Date.parse(observedAt) + PHOTO_VALID_MS).toISOString(),
    observedAt,
    displayAllowed: true as const,
    hotlinkAllowed: true as const,
  };
}

function observationFrom(
  item: unknown,
  origin: string,
  observedAt: string,
): Observation | null {
  const data = record(item);
  const ref = data.objectReference;
  if (typeof ref !== 'string' || !OBJECT_REF.test(ref)) return null;
  const kind = typeOf(data.estateType);
  const status = statusOf(data);
  if (kind === null || status === null) return null;
  const address = record(data.address);
  const details = record(data.details);
  const advertise = record(details.advertiseOn);
  // A hidden address is not shown here either: the title falls back to the area and there is no position.
  const hideAddress = advertise.hideAddress === true;
  const title = (
    (!hideAddress && text(address.streetAddress)) ||
    text(address.area)
  ).slice(0, 200);
  if (title === '') return null;
  const latitude = numberOf(address.latitude);
  const longitude = numberOf(address.longitude);
  const hasPoint =
    !hideAddress &&
    latitude !== null &&
    longitude !== null &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0);
  const municipality = text(address.municipality);
  const facts: Facts = {
    propertyType: kind.propertyType,
    tenure: kind.tenure,
    // Every kept home comes from the for-sale and coming-soon statuses.
    purchase: true,
    livingAreaM2: area(numberOf(data.livingSpace)),
    secondaryAreaM2: null,
    rooms: area(numberOf(data.numberOfRooms), 100),
    // A hidden price and a zero or missing price (coming-soon homes often have none) are unknown, never zero.
    askingPriceSek:
      advertise.hidePrice === true
        ? null
        : positiveInt(numberOf(data.startingPrice), 1_000_000_000),
    // Only an apartment's floor means something here; a number is read by the shared floor rule.
    groundFloor:
      kind.propertyType === 'apartment'
        ? groundFloorOf(record(details.floorAndElevator).floor)
        : null,
    lift: null,
    liftServesHome: null,
    stepFree: null,
    outdoor: null,
    glazed: null,
    largePrivateTerrace: null,
    municipality: municipality === '' ? null : municipality.slice(0, 100),
    baseFeeSek: positiveInt(numberOf(data.monthlyFee), 1_000_000_000),
    mandatoryMonthlySek: null,
    status,
  };
  // The list holds every viewing, with a year. Times are Stockholm wall-clock time labelled Z, as Boneo's are
  // (the same home carries identical values in both). Only viewings the broker shows on the internet are kept.
  const viewings = finishViewings(
    (Array.isArray(data.viewings) ? data.viewings : [])
      .slice(0, 30)
      .flatMap((entry) => {
        const viewing =
          isRecord(entry) && entry.showOnInternet === true
            ? viewingFromLabelledWallClock(entry.startTime, entry.endTime)
            : null;
        return viewing === null ? [] : [viewing];
      }),
    new Date(observedAt),
  );
  const parsed = observationSchema.safeParse({
    sourceListingId: ref,
    // The list gives no relisting marker, so a home keeps one episode.
    episodeId: 'listed',
    // The public page redirects /estate/<ref> to the same address with a trailing slash.
    sourceUrl: `${origin}/estate/${ref}/`,
    title,
    observedAt,
    publishedAt: null,
    facts,
    conflicts: [],
    coordinates: hasPoint
      ? {
          longitude,
          latitude,
          precision: positionPrecision(title),
          source: 'husman-hagberg-list',
          observedAt,
        }
      : null,
    evidence: [],
    photo: photoFrom(data, observedAt),
    ...(viewings ? { viewings } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * The one list: JSON in, observations out. The search is a text match, so only homes in the partition's
 * municipality are kept, and the rest count as skipped. Anything that is not a non-empty list is failed
 * coverage, never an empty result. There is no second page: a list shorter than its own count is reported
 * as ended before the total, so the partition is truncated and the run is never complete.
 */
export function readHusmanHagbergSearchPage(
  body: string,
  context: ReadContext,
): PageRead {
  if (body.length > MAX_HTML_CHARS)
    return { kind: 'failed', reason: 'too-large' };
  let data: unknown;
  try {
    data = JSON.parse(body.replace(/^﻿/, ''));
  } catch {
    return { kind: 'failed', reason: 'invalid-embedded-data' };
  }
  const estates = record(data).estates;
  if (!Array.isArray(estates))
    return { kind: 'failed', reason: 'unexpected-shape' };
  if (estates.length === 0)
    return { kind: 'failed', reason: 'no-results-list' };

  const observedAt = context.observedAt.toISOString();
  const wanted = context.municipality?.trim().toLowerCase();
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const item of estates) {
    const observation = observationFrom(item, context.origin, observedAt);
    if (observation === null || seen.has(observation.sourceListingId)) continue;
    seen.add(observation.sourceListingId);
    if (
      wanted !== undefined &&
      observation.facts.municipality?.toLowerCase() !== wanted
    )
      continue;
    observations.push(observation);
  }
  const count = numberOf(record(data).count);
  const more: MorePages =
    count !== null && count > estates.length
      ? { kind: 'unknown', reason: 'empty-page-before-total' }
      : { kind: 'none' };
  return {
    kind: 'page',
    observations,
    itemCount: estates.length,
    skipped: estates.length - observations.length,
    total: count ?? estates.length,
    more,
  };
}
