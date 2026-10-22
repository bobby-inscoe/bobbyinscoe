import { z } from 'zod';
import {
  factsSchema,
  type SourcePolicy,
  sourcePolicySchema,
} from '@/features/house-scanner/types/contracts';
import { assertSourceAllowed } from '@/features/house-scanner/utils/source-policy';

export const DEMO_SOURCE_ID = 'synthetic-demo';
export const BONEO_SOURCE_ID = 'boneo';
export const BONEO_ORIGIN = 'https://www.boneo.se';
export const BONEO_IMAGE_ORIGIN = 'https://files.boneo.se';
export const BJURFORS_SOURCE_ID = 'bjurfors';
export const STADSHEM_SOURCE_ID = 'stadshem';
export const STADSHEM_ORIGIN = 'https://stadshem.se';
// Google Cloud Storage, shared by many sites; the bucket is in each image's path.
export const STADSHEM_IMAGE_ORIGIN = 'https://storage.googleapis.com';
export const LUNDIN_SOURCE_ID = 'lundin';
// Photos come from the same host as the listing pages.
export const LUNDIN_ORIGIN = 'https://www.lundin.se';
export const HUSMAN_HAGBERG_SOURCE_ID = 'husman-hagberg';
export const HUSMAN_HAGBERG_ORIGIN = 'https://www.husmanhagberg.se';
// Photos come from the broker's media host.
export const HUSMAN_HAGBERG_IMAGE_ORIGIN = 'https://media.husmanhagberg.se';
export const SVENSKFAST_SOURCE_ID = 'svenskfast';
export const SVENSKFAST_ORIGIN = 'https://www.svenskfast.se';
// Photos come from the broker's image host.
export const SVENSKFAST_IMAGE_ORIGIN = 'https://i.sfcdn.se';
export const ERIK_OLSSON_SOURCE_ID = 'erik-olsson';
export const ERIK_OLSSON_ORIGIN = 'https://www.erikolsson.se';
// Cloudflare Images, shared by many sites; the account is in each image's path.
export const ERIK_OLSSON_IMAGE_ORIGIN = 'https://imagedelivery.net';
// Photos come from the same host as the listing pages.
export const BJURFORS_ORIGIN = 'https://www.bjurfors.se';
export const capabilitySchema = z.strictObject({
  policy: sourcePolicySchema,
  executor: z.enum([
    'demo-only',
    'boneo-personal-read',
    'bjurfors-personal-read',
    'erik-olsson-personal-read',
    'stadshem-personal-read',
    'lundin-personal-read',
    'husman-hagberg-personal-read',
    'svenskfast-personal-read',
    'none',
  ]),
  nativeNumericFiltersVerified: z.boolean(),
  geographicPartitioning: z.enum(['municipality', 'unverified']),
});
export type SourceCapability = z.infer<typeof capabilitySchema>;

const reviewedAt = '2026-10-12T00:00:00Z';
const reviewDueAt = '2027-01-10T00:00:00Z';
const noCapabilities: SourcePolicy['capabilities'] = {
  discovery: false,
  knownListingRefresh: false,
  unknownPrice: false,
  upcoming: false,
  pagination: false,
  resultCap: null,
  coverageGaps: [
    'Collection and reuse permission is absent; no live inventory coverage.',
    'Identity, pagination, unknown prices, upcoming inventory and updates are unverified.',
  ],
};

const candidates = [
  ['alvhem', 'https://www.alvhem.com', 'pending'],
  ['fastighetsbyran', 'https://www.fastighetsbyran.com', 'disabled'],
  ['booli', 'https://www.booli.se', 'disabled'],
  ['hemnet', 'https://www.hemnet.se', 'disabled'],
  ['norban', 'https://norban.se', 'disabled'],
] as const;

export function sourceRegistry(): SourceCapability[] {
  const common = {
    revision: 1,
    reviewedAt,
    reviewDueAt,
    imageOrigins: [],
    allowedEvidenceSubjects: [],
    freeOnly: true,
    imageDisplay: false,
    imageHotlink: false,
    modelProcessing: false,
    emailDigest: false,
    telegramDigest: false,
    retentionDays: 30,
  } as const;
  return [
    capabilitySchema.parse({
      policy: {
        ...common,
        sourceId: DEMO_SOURCE_ID,
        status: 'approved',
        listingOrigins: ['https://example.invalid'],
        automatedCollection: true,
        privateDisplay: true,
        rightsBasis:
          'Fictional, authored fixture data only. No live-source permission or coverage.',
        allowedFactFields: factsSchema
          .keyof()
          .options.filter(
            (field) =>
              !['secondaryAreaM2', 'mandatoryMonthlySek'].includes(field),
          ),
        capabilities: {
          discovery: true,
          knownListingRefresh: true,
          unknownPrice: true,
          upcoming: true,
          pagination: true,
          resultCap: 100,
          coverageGaps: [
            'Synthetic fixtures only; no live discovery or refresh.',
          ],
        },
      },
      executor: 'demo-only',
      nativeNumericFiltersVerified: false,
      geographicPartitioning: 'municipality',
    }),
    capabilitySchema.parse({
      policy: {
        ...common,
        sourceId: BONEO_SOURCE_ID,
        // Pending is not approved: the operator sets approval in the database.
        status: 'pending',
        // Revision 2 turned on hotlinked photos from the image host. Revision 3 adds outdoor and glazed. Revision 4 adds groundFloor.
        revision: 5,
        viewings: true,
        retentionDays: 14,
        listingOrigins: [BONEO_ORIGIN],
        imageOrigins: [BONEO_IMAGE_ORIGIN],
        imageDisplay: true,
        imageHotlink: true,
        automatedCollection: false,
        privateDisplay: false,
        rightsBasis:
          'Permission unresolved. The household owner chose to read public search pages for personal use at their own judgment. Technical access is not a reuse license.',
        allowedFactFields: [
          'propertyType',
          'tenure',
          'purchase',
          'livingAreaM2',
          'secondaryAreaM2',
          'rooms',
          'askingPriceSek',
          'municipality',
          'baseFeeSek',
          'status',
          'outdoor',
          'glazed',
          'groundFloor',
        ],
        capabilities: {
          discovery: true,
          knownListingRefresh: false,
          unknownPrice: false,
          upcoming: false,
          pagination: false,
          resultCap: null,
          coverageGaps: [
            'Permission is unresolved and the source is not approved.',
            'Only the Till salu view was observed. Upcoming (Kommande) inventory appears in facet counts but its query is unproven.',
            'Whether listings without a price appear in the default view is unproven.',
            'The page query is accepted but page size and multi-page ordering are unproven. Coverage is never reported complete.',
            'Only apartment paths for Goteborg are supported. Houses and other municipalities are not covered.',
            'Outdoor, glazing and floor come from each kept listing page; glazing only from description wording. Only floor 2 or higher (or an explicit ground floor) is a fact; floor 1 stays unknown. Lift and build year are not collected.',
            'Only the first photo is shown, hotlinked from the broker image host. Nothing is copied or stored.',
            'Listing identity and episode rules come from property_id and created_date and are unproven across relistings.',
            'Viewing times are the full list in the search data (group_viewings). The feed labels Stockholm wall-clock time with a Z, so the letter is dropped and the time read as Stockholm time; the same viewing on the Bjurfors page matched. A viewing can be cancelled between scans.',
            'Known listings cannot be refreshed outside discovery.',
          ],
        },
      },
      executor: 'boneo-personal-read',
      nativeNumericFiltersVerified: false,
      geographicPartitioning: 'unverified',
    }),
    capabilitySchema.parse({
      policy: {
        ...common,
        sourceId: BJURFORS_SOURCE_ID,
        revision: 2,
        viewings: true,
        // Pending is not approved: the operator sets approval in the database.
        status: 'pending',
        retentionDays: 14,
        listingOrigins: [BJURFORS_ORIGIN],
        imageOrigins: [BJURFORS_ORIGIN],
        imageDisplay: true,
        imageHotlink: true,
        automatedCollection: false,
        privateDisplay: false,
        rightsBasis:
          'Permission unresolved. The household owner chose to read public search pages for personal use at their own judgment. Technical access is not a reuse license.',
        allowedFactFields: [
          'propertyType',
          'tenure',
          'purchase',
          'livingAreaM2',
          'secondaryAreaM2',
          'rooms',
          'askingPriceSek',
          'municipality',
          'baseFeeSek',
          'status',
          'outdoor',
          'groundFloor',
          'lift',
        ],
        capabilities: {
          discovery: true,
          knownListingRefresh: false,
          unknownPrice: false,
          upcoming: false,
          pagination: false,
          resultCap: null,
          coverageGaps: [
            'Permission is unresolved and the source is not approved.',
            'Only the Goteborg municipality search is supported. Other municipalities are not covered.',
            'The search page lists its total and page links, so a full read is detected, but only the default Till salu view was observed. Whether upcoming homes or homes without a price are all included is unproven.',
            'Cards give area, rooms and sometimes a price; the property type is only known from the listing page, so houses are dropped after that page is read.',
            'A card that links outside the for-sale listing path, such as a project page, is skipped and not read.',
            'Listing pages are read for kept listings only, up to the per-run cap. Balcony, floor, fee, lift, tenure and coordinates come from the page; glazing is not collected.',
            'Balcony is a fact only when the page says Ja. An absent or unticked box stays unknown. Lift is a fact only when the page says Ja. Only floor 2 or higher (or an explicit ground floor) is a floor fact.',
            'Coordinates come from the listing page and matched an independent geocoder within 12 m on four of four listings. Precision is address for a title with a house number.',
            'Upcoming status is inferred from the PreOrder availability value on one page and is unproven.',
            'Only the first photo is shown, hotlinked from the broker host. It loaded without a referrer. Nothing is copied or stored.',
            'Listing identity is the listing page path and the episode never changes, so a relisting of the same home is not told apart.',
            'Viewing times come from each home page, which is read again at most weekly, so a new viewing can appear late and a cancelled one can linger until then. Times are Stockholm time with no zone, converted here.',
            'Known listings cannot be refreshed outside discovery.',
          ],
        },
      },
      executor: 'bjurfors-personal-read',
      nativeNumericFiltersVerified: false,
      geographicPartitioning: 'unverified',
    }),
    capabilitySchema.parse({
      policy: {
        ...common,
        sourceId: ERIK_OLSSON_SOURCE_ID,
        revision: 2,
        viewings: true,
        // Pending is not approved: the operator sets approval in the database.
        status: 'pending',
        retentionDays: 14,
        listingOrigins: [ERIK_OLSSON_ORIGIN],
        imageOrigins: [ERIK_OLSSON_IMAGE_ORIGIN],
        imageDisplay: true,
        imageHotlink: true,
        automatedCollection: false,
        privateDisplay: false,
        rightsBasis:
          'Permission unresolved. The household owner chose to read public search pages for personal use at their own judgment. Its terms grant a personal, non-commercial licence and do not mention automated reading, and limit copying and reproducing. Photos are loaded by the viewer browser from the broker image host, never copied. Technical access is not a reuse license.',
        allowedFactFields: [
          'propertyType',
          'tenure',
          'purchase',
          'livingAreaM2',
          'secondaryAreaM2',
          'rooms',
          'askingPriceSek',
          'municipality',
          'baseFeeSek',
          'status',
          'outdoor',
          'groundFloor',
          'lift',
        ],
        capabilities: {
          discovery: true,
          knownListingRefresh: false,
          unknownPrice: false,
          upcoming: false,
          pagination: false,
          resultCap: null,
          coverageGaps: [
            'Permission is unresolved and the source is not approved.',
            'Only the Goteborg municipality search is supported. Other municipalities are not covered.',
            'Pre-market homes (Underhand) show no street and have no page of their own, so they are counted and skipped. They were most of the first result page and a minority of the second.',
            'Result pages hold sixteen cards and carry a total, so a full read is detected, but only the default for-sale search was observed. Whether upcoming homes or homes without an asking price are all included is unproven.',
            'Cards give type, area, rooms, fee and price. Balcony, patio, floor, lift, tenure, status and coordinates come from each kept home page, read up to the per-run cap.',
            'Balcony and patio are facts only when ticked; an unticked box stays unknown. Lift is a fact only when the page says yes. Only floor 2 or higher (or floor 0) is a floor fact. Glazing is not collected.',
            'Coordinates come from the broker and are used only when the address is not hidden. They are labelled address-level when the title has a house number; accuracy was not compared with an independent geocoder.',
            "Only the first photo is shown, hotlinked from the broker's Cloudflare Images address (imagedelivery.net, shared by other sites, with no robots.txt). The thumbnail variant loaded as a JPEG of about 39 kB on one sample. Nothing is copied or stored.",
            'Listing identity is the numeric id at the end of the page path and the episode never changes, so a relisting of the same home is not told apart.',
            'Viewing times are only the next viewing shown on the search card, as Swedish text with no year; the year is worked out from the weekday and dates that do not fit are dropped.',
            'Known listings cannot be refreshed outside discovery.',
          ],
        },
      },
      executor: 'erik-olsson-personal-read',
      nativeNumericFiltersVerified: false,
      geographicPartitioning: 'unverified',
    }),
    capabilitySchema.parse({
      policy: {
        ...common,
        sourceId: STADSHEM_SOURCE_ID,
        revision: 2,
        viewings: true,
        // Pending is not approved: the operator sets approval in the database.
        status: 'pending',
        retentionDays: 14,
        listingOrigins: [STADSHEM_ORIGIN],
        imageOrigins: [STADSHEM_IMAGE_ORIGIN],
        imageDisplay: true,
        imageHotlink: true,
        automatedCollection: false,
        privateDisplay: false,
        rightsBasis:
          'Permission unresolved. The household owner chose to read the public estates list for personal use at their own judgment. The site publishes only a privacy policy and no terms of use. Technical access is not a reuse license.',
        allowedFactFields: [
          'propertyType',
          'tenure',
          'purchase',
          'livingAreaM2',
          'rooms',
          'askingPriceSek',
          'municipality',
          'baseFeeSek',
          'status',
          'groundFloor',
          'lift',
        ],
        capabilities: {
          discovery: true,
          knownListingRefresh: false,
          unknownPrice: false,
          upcoming: false,
          pagination: false,
          resultCap: null,
          coverageGaps: [
            'Permission is unresolved and the source is not approved.',
            'Only the Goteborg municipality is supported. The list covers all of Sweden and is filtered by municipality here.',
            'The data is the JSON list that the site pages load (api/estates). It is not a documented public API and can change without notice.',
            'Homes marked coming soon are read too and marked upcoming; many have no asking price. Whether every coming-soon home is listed is unproven.',
            'One answer held every home (94 on 17 October) and reports its page count, so a full read is detected. Only the two status filters were used and the result was not compared with an unfiltered read.',
            'Floor and lift come from each kept home record: floor 2 or higher, or floor 0, is a floor fact, and lift only when the record says yes. Balcony and glazing are not collected: there is no structured field.',
            'Coordinates come from the list and are labelled address-level when the title has a house number. They were not compared with an independent geocoder.',
            'Only the primary photo is shown, hotlinked from Google Cloud Storage (storage.googleapis.com, shared by other sites). Nothing is copied or stored.',
            'Listing identity is the estate id and the episode never changes, so a relisting of the same home is not told apart.',
            'Viewing times are only the next viewing (nextViewing) in the list, in Stockholm time with no zone, converted here. Set on 39 of 94 homes on 17 October.',
            'Known listings cannot be refreshed outside discovery.',
          ],
        },
      },
      executor: 'stadshem-personal-read',
      nativeNumericFiltersVerified: false,
      geographicPartitioning: 'unverified',
    }),
    capabilitySchema.parse({
      policy: {
        ...common,
        sourceId: LUNDIN_SOURCE_ID,
        // Pending is not approved: the operator sets approval in the database.
        status: 'pending',
        retentionDays: 14,
        listingOrigins: [LUNDIN_ORIGIN],
        imageOrigins: [LUNDIN_ORIGIN],
        imageDisplay: true,
        imageHotlink: true,
        automatedCollection: false,
        privateDisplay: false,
        rightsBasis:
          "Permission unresolved. The household owner chose to read the broker's public list for personal use at their own judgment. The site publishes only a privacy policy and no terms of use, and its robots.txt disallows file paths only. Technical access is not a reuse license.",
        allowedFactFields: [
          'propertyType',
          'tenure',
          'purchase',
          'livingAreaM2',
          'rooms',
          'askingPriceSek',
          'municipality',
          'baseFeeSek',
          'status',
        ],
        capabilities: {
          discovery: true,
          knownListingRefresh: false,
          unknownPrice: false,
          upcoming: false,
          pagination: false,
          resultCap: null,
          coverageGaps: [
            'Permission is unresolved and the source is not approved.',
            'Göteborg and Mölndal are supported. The list covers every place the broker sells in; the municipality is worked out from the city and district fields, and homes in other places or in unrecognised districts are skipped.',
            'The data is the JSON list that the site page loads (api/list). It is not a documented public API and can change without notice.',
            'The whole list is one request, so no home page is read: floor, lift, balcony and glazing stay unknown. Viewing times are not in the list.',
            'Coming-soon homes are read too and marked upcoming; many have no asking price. Sold homes, plots and new production are skipped.',
            'The list has no coordinates, so a position is estimated from the street address for the homes that are kept.',
            "Only the primary photo is shown, hotlinked from the broker's own image address. Nothing is copied or stored.",
            'Listing identity is the object id and the episode never changes, so a relisting of the same home is not told apart.',
            'Viewing times are not published in the list; booking goes through a third-party page that is not read.',
            'Known listings cannot be refreshed outside discovery.',
          ],
        },
      },
      executor: 'lundin-personal-read',
      nativeNumericFiltersVerified: false,
      geographicPartitioning: 'unverified',
    }),
    capabilitySchema.parse({
      policy: {
        ...common,
        sourceId: HUSMAN_HAGBERG_SOURCE_ID,
        // Revision 2 reads each kept home's estate page for up to four photos and the floor plan.
        revision: 2,
        viewings: true,
        // Pending is not approved: the operator sets approval in the database.
        status: 'pending',
        retentionDays: 14,
        listingOrigins: [HUSMAN_HAGBERG_ORIGIN],
        imageOrigins: [HUSMAN_HAGBERG_IMAGE_ORIGIN],
        imageDisplay: true,
        imageHotlink: true,
        automatedCollection: false,
        privateDisplay: false,
        rightsBasis:
          "Permission unresolved. The household owner chose to read the broker's public list and the public estate page of each kept home for personal use at their own judgment. The terms of use (checked 17 October 2026) say nothing about automated reading and bar copying and spreading protected texts and images without consent, and robots.txt allows everything. Technical access is not a reuse license.",
        allowedFactFields: [
          'propertyType',
          'tenure',
          'purchase',
          'livingAreaM2',
          'rooms',
          'askingPriceSek',
          'municipality',
          'baseFeeSek',
          'status',
          'groundFloor',
        ],
        capabilities: {
          discovery: true,
          knownListingRefresh: false,
          unknownPrice: false,
          upcoming: false,
          pagination: false,
          resultCap: null,
          coverageGaps: [
            'Permission is unresolved and the source is not approved.',
            'Only Göteborg is supported. The list is a text search on the name Göteborg, so a home in the municipality whose address never says Göteborg may be missed: the broker counted 206 for Göteborg and the search returned 143, and the reason for the gap was not checked.',
            'The data is the JSON list that the site pages load from api.husmanhagberg.se (object/api/objects). It is not a documented public API and can change without notice. That host serves no robots.txt (404), so the run reads the robots.txt of www.husmanhagberg.se, which also covers the estate pages.',
            'The answer holds every match when asked for 200 a page (143 on 17 October) and reports a total, so a list shorter than its total is detected and reported as truncated. A paging parameter was not found.',
            'Coming-soon homes (taken in and shown as coming) are read too and marked upcoming; most have no asking price. Whether every coming-soon home is listed is unproven.',
            'The list gives no tenure for houses, so it stays unknown. Holiday homes, commercial property and any other type are skipped.',
            'The floor of an apartment comes from the list: floor 2 or higher, or floor 0, is a floor fact. Lift, balcony and glazing are not in the list and stay unknown.',
            'Coordinates come from the broker and are labelled address-level when the title has a house number. They were not compared with an independent geocoder. A hidden address gets no position.',
            'Up to four photos and one floor plan come from the estate page of each kept home, read up to the per-run cap and reused for a week; area pictures are left out. Otherwise only the list photo is shown. Images are hotlinked from the broker media host and never copied or stored.',
            'Listing identity is the object reference and the episode never changes, so a relisting of the same home is not told apart.',
            'Viewing times are the full list in the search data, with a year. The feed labels Stockholm wall-clock time with a Z (the same home shows identical values on Boneo), so the letter is dropped. Only viewings marked for the internet are kept.',
            'Known listings cannot be refreshed outside discovery.',
          ],
        },
      },
      executor: 'husman-hagberg-personal-read',
      nativeNumericFiltersVerified: false,
      geographicPartitioning: 'unverified',
    }),
    capabilitySchema.parse({
      policy: {
        ...common,
        sourceId: SVENSKFAST_SOURCE_ID,
        viewings: true,
        // Pending is not approved: the operator sets approval in the database.
        status: 'pending',
        retentionDays: 14,
        listingOrigins: [SVENSKFAST_ORIGIN],
        imageOrigins: [SVENSKFAST_IMAGE_ORIGIN],
        imageDisplay: true,
        imageHotlink: true,
        automatedCollection: false,
        privateDisplay: false,
        rightsBasis:
          "Permission unresolved. The household owner chose to read the broker's public pages for personal use at their own judgment. No clause on automated reading was found (checked 17 October 2026), and robots.txt allows the list and home paths while disallowing some filter query strings. Technical access is not a reuse license.",
        allowedFactFields: [
          'propertyType',
          'tenure',
          'purchase',
          'livingAreaM2',
          'rooms',
          'askingPriceSek',
          'municipality',
          'baseFeeSek',
          'status',
          'groundFloor',
          'lift',
        ],
        capabilities: {
          discovery: true,
          knownListingRefresh: false,
          unknownPrice: false,
          upcoming: false,
          pagination: true,
          resultCap: null,
          coverageGaps: [
            'Permission is unresolved and the source is not approved.',
            'Only the Göteborg municipality list is supported. Other municipalities are not covered.',
            'The list pages carry schema.org JSON-LD and a total in the page title, 35 homes a page (607 for Göteborg on 17 October, 18 pages). The pages are the site pages themselves, not an API, and the markup can change without notice.',
            'The list has no price, fee, floor, lift or position. Each kept home page is read for them, up to the per-run cap, and a home page is reused for a week. A full first run is about 18 list pages plus up to 150 home pages of about 300 kB.',
            'A price of 0 on the home page means the home has none, and is unknown. Coming-soon homes were not seen; availability PreOrder is read as upcoming but is inferred.',
            'Floor 2 or higher, or floor 0, is a floor fact. Lift is a fact only when the page says yes. Balcony and glazing are not collected. A house has no tenure on the list.',
            'Viewing times are the rows of the home page, with a day, month and weekday but no year; the year is worked out from the weekday and dates that do not fit are dropped. The registration note is dropped.',
            'Coordinates come from the home page when it has them (comma decimals) and are labelled address-level when the title has a house number. Otherwise a position is estimated from the street address. Underhand homes show a street with no number.',
            'Only the primary photo is shown, hotlinked from the broker image host (i.sfcdn.se). Its addresses contain a literal "..." and are used as given. Nothing is copied or stored.',
            'Listing identity is the numeric id at the end of the page path and the episode never changes, so a relisting of the same home is not told apart.',
            'Known listings cannot be refreshed outside discovery.',
          ],
        },
      },
      executor: 'svenskfast-personal-read',
      nativeNumericFiltersVerified: false,
      geographicPartitioning: 'unverified',
    }),
    ...candidates.map(([sourceId, origin, status]) =>
      capabilitySchema.parse({
        policy: {
          ...common,
          sourceId,
          status,
          listingOrigins: [origin],
          automatedCollection: false,
          privateDisplay: false,
          rightsBasis:
            'Permission unresolved or restricted. Technical access is not a reuse license.',
          allowedFactFields: [],
          capabilities: noCapabilities,
        },
        executor: 'none',
        nativeNumericFiltersVerified: false,
        geographicPartitioning: 'unverified',
      }),
    ),
  ];
}

export function assertDemoExecution(
  capability: SourceCapability,
  at: Date,
): void {
  const validated = capabilitySchema.parse(capability);
  assertSourceAllowed(validated.policy, at);
  if (
    validated.executor !== 'demo-only' ||
    validated.policy.sourceId !== DEMO_SOURCE_ID ||
    validated.policy.listingOrigins.length !== 1 ||
    validated.policy.listingOrigins[0] !== 'https://example.invalid' ||
    validated.policy.imageOrigins.length !== 0
  ) {
    throw new Error(
      'No permitted executor: only the authored synthetic source can execute.',
    );
  }
}

// The registry keeps real sources pending, so approval is an explicit owner step. This builds
// the approved policy the owner writes to the database. Valid for 90 days.
export function approvedPolicy(
  sourceId: string,
  now = new Date(),
): SourcePolicy {
  const entry = sourceRegistry().find(
    (item) => item.policy.sourceId === sourceId,
  );
  if (!entry) throw new Error('Unknown source.');
  const day = 24 * 60 * 60 * 1000;
  return sourcePolicySchema.parse({
    ...entry.policy,
    status: 'approved',
    automatedCollection: true,
    privateDisplay: true,
    capabilities: {
      ...entry.policy.capabilities,
      coverageGaps: entry.policy.capabilities.coverageGaps.filter(
        (gap) => !gap.includes('not approved'),
      ),
    },
    // Five minutes back so database clock skew cannot put the review in the future.
    reviewedAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    reviewDueAt: new Date(now.getTime() + 90 * day).toISOString(),
  });
}
