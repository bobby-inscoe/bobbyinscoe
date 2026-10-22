import { z } from 'zod';

export const CONTRACT_VERSION = 1;
const id = z.uuid();
const timestamp = z.iso.datetime({ offset: true });
const money = z.number().int().nonnegative().max(1_000_000_000);
const sourceId = z.string().regex(/^[a-z0-9-]{1,60}$/);
// z.url() can accept strings that the URL constructor then rejects (for example
// some punycode or numeric hosts). A throw inside a refinement escapes safeParse,
// so every URL refinement goes through this guard and fails validation instead.
// Punycode (xn--) hosts are refused outright, as the database does: whether the URL constructor
// accepts an invalid one such as xn--a differs between Node and browser versions.
function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return /(^|\.)xn--/i.test(url.hostname) ? null : url;
  } catch {
    return null;
  }
}
const originSchema = z
  .url()
  .refine((value) => parseUrl(value)?.origin === value);
export const listingUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = parseUrl(value);
    return (
      url !== null &&
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, 'validation.useAnHTTPSLinkWithoutCredentials');

export const criteriaSchema = z
  .strictObject({
    minAreaM2: z.number().positive().max(10000),
    maxAreaM2: z.number().positive().max(10000).nullable(),
    minRooms: z.number().positive().max(100),
    preferredPriceSek: money,
    stretchPriceSek: money,
    propertyTypes: z
      .array(z.enum(['apartment', 'house']))
      .min(1)
      .max(2),
    excludeGroundFloor: z.boolean(),
    requireLift: z.boolean(),
    requireOutdoor: z.boolean(),
    // Retained for saved-profile compatibility; glazing no longer affects matching.
    preferGlazing: z.boolean(),
    feeReferenceSek: money,
    geography: z.strictObject({
      mode: z.enum(['municipalities', 'radius']).optional(),
      municipalities: z.array(z.string().min(1).max(100)).min(1).max(100),
      center: z.tuple([
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
      ]),
      radiusKm: z.number().positive().max(100),
    }),
    nature: z.strictObject({
      preferImmediateGreenery: z.boolean(),
      preferredWalkMinutes: z.number().positive().max(120),
    }),
    transit: z.strictObject({
      preferredWalkMinutes: z.number().positive().max(120),
      preferredJourneyMinutes: z.number().positive().max(240),
      tradeoffJourneyMinutes: z.number().positive().max(240),
    }),
    // The sources this household browses. Absent means every source; it never changes collection.
    sourceIds: z.array(sourceId).min(1).max(20).optional(),
  })
  .refine(
    (c) => c.maxAreaM2 === null || c.maxAreaM2 >= c.minAreaM2,
    'validation.maximumAreaMustCoverMinimumArea',
  )
  .refine(
    (c) => c.stretchPriceSek >= c.preferredPriceSek,
    'validation.stretchPriceMustCoverPreferredPrice',
  )
  .refine(
    (c) =>
      c.transit.tradeoffJourneyMinutes >= c.transit.preferredJourneyMinutes,
    'validation.tradeOffJourneyMustCoverPreferredJourney',
  );

export const profileSchema = z.strictObject({
  id,
  householdId: id,
  revision: z.number().int().positive(),
  name: z.string().min(1).max(80),
  enabled: z.boolean(),
  criteria: criteriaSchema,
  editedBy: id,
  /** Time of this member edit, independent of collector refreshes. */
  editedAt: timestamp,
});
export const evidenceSchema = z.strictObject({
  id,
  kind: z.enum([
    'source_claim',
    'buyer_observation',
    'measurement',
    'model_interpretation',
  ]),
  subject: z.enum([
    'facts',
    'nearby_nature',
    'nature_access',
    'green_outlook',
    'privacy',
    'quietness',
    'transit',
  ]),
  summary: z.string().min(1).max(1000),
  sourceUrl: listingUrlSchema.nullable(),
  observedAt: timestamp,
  datasetVersion: z.string().max(120).nullable(),
  method: z.string().max(200).nullable(),
  value: z.number().finite().nullable(),
  unit: z
    .enum(['metres_straight_line', 'minutes_routed', 'decibels'])
    .nullable(),
});
export const coordinateSchema = z.strictObject({
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-90).max(90),
  /** Granularity of the position; an address estimate is still uncertain. */
  precision: z.enum([
    'address',
    'building',
    'approximate_area',
    'user_supplied',
  ]),
  /** Position provenance, including whether OpenStreetMap matched an address or only a street. */
  source: z.string().min(1).max(120),
  /** When this position was observed; not the listing discovery time. */
  observedAt: timestamp,
  /** Geocoded rather than source-supplied. Absent means false for older fingerprints. */
  estimated: z.boolean().optional(),
});
export const factsSchema = z.strictObject({
  propertyType: z.enum(['apartment', 'house']).nullable(),
  tenure: z.enum(['ownership', 'cooperative', 'rental', 'unknown']),
  purchase: z.boolean().nullable(),
  livingAreaM2: z.number().positive().max(10000).nullable(),
  secondaryAreaM2: z.number().nonnegative().max(10000).nullable(),
  rooms: z.number().positive().max(100).nullable(),
  askingPriceSek: money.positive().nullable(),
  groundFloor: z.boolean().nullable(),
  lift: z.boolean().nullable(),
  liftServesHome: z.boolean().nullable(),
  stepFree: z.boolean().nullable(),
  outdoor: z.enum(['balcony', 'terrace', 'both', 'none']).nullable(),
  glazed: z.boolean().nullable(),
  largePrivateTerrace: z.boolean().nullable(),
  municipality: z.string().max(100).nullable(),
  baseFeeSek: money.nullable(),
  mandatoryMonthlySek: money.nullable(),
  status: z.enum(['upcoming', 'available', 'sold', 'withdrawn', 'unknown']),
});
export const photoSchema = z.strictObject({
  url: listingUrlSchema,
  attribution: z.string().min(1).max(300),
  rightsBasis: z.string().min(1).max(500),
  /** Latest time the source policy permits displaying this photo. */
  expiresAt: timestamp,
  /** When the collector saw this photo, used for retention. */
  observedAt: timestamp,
  displayAllowed: z.literal(true),
  hotlinkAllowed: z.literal(true),
});
// One viewing the broker published: a start, and an end when the source gives one. Times are UTC.
export const viewingSchema = z.strictObject({
  startsAt: timestamp,
  endsAt: timestamp.nullable(),
});
export const observationSchema = z.strictObject({
  /** Source-local identity, stable across ordinary listing refreshes. */
  sourceListingId: z.string().min(1).max(200),
  /** Source marketing episode; a later relisting can start a separate price history. */
  episodeId: z.string().min(1).max(200),
  sourceUrl: listingUrlSchema,
  title: z.string().min(1).max(200),
  /** Collector observation time; refreshed even when the meaningful content is unchanged. */
  observedAt: timestamp,
  /** Broker publication time, when known; distinct from server discovery. */
  publishedAt: timestamp.nullable(),
  facts: factsSchema,
  conflicts: z.array(factsSchema.keyof()).max(20),
  coordinates: coordinateSchema.nullable(),
  evidence: z.array(evidenceSchema).max(50),
  photo: photoSchema.nullable(),
  // Up to three photos after `photo`, in the source's order, and one floor plan. Left out when there are none.
  morePhotos: z.array(photoSchema).min(1).max(3).optional(),
  floorPlan: photoSchema.optional(),
  // Future viewings, sorted. The key is left out when there are none, so older readers keep parsing.
  viewings: z.array(viewingSchema).max(10).optional(),
});
export const sourcePolicySchema = z.strictObject({
  sourceId,
  revision: z.number().int().positive(),
  status: z.enum(['disabled', 'pending', 'approved']),
  /** When source collection/display permissions were reviewed. */
  reviewedAt: timestamp,
  /** Deadline for renewing that policy review. */
  reviewDueAt: timestamp,
  rightsBasis: z.string().min(1).max(2000),
  listingOrigins: z.array(originSchema).min(1).max(20),
  imageOrigins: z.array(originSchema).max(20),
  allowedEvidenceSubjects: z.array(evidenceSchema.shape.subject).max(10),
  freeOnly: z.literal(true),
  automatedCollection: z.boolean(),
  privateDisplay: z.boolean(),
  imageDisplay: z.boolean(),
  imageHotlink: z.boolean(),
  modelProcessing: z.boolean(),
  emailDigest: z.boolean(),
  telegramDigest: z.boolean(),
  // Whether this source's viewing times may be shown. Absent means no.
  viewings: z.boolean().optional(),
  allowedFactFields: z.array(factsSchema.keyof()).max(20),
  retentionDays: z.number().int().positive().max(180),
  capabilities: z.strictObject({
    discovery: z.boolean(),
    knownListingRefresh: z.boolean(),
    unknownPrice: z.boolean(),
    upcoming: z.boolean(),
    pagination: z.boolean(),
    resultCap: z.number().int().positive().nullable(),
    coverageGaps: z.array(z.string().max(300)).max(30),
  }),
});
export const memberSchema = z.strictObject({
  householdId: id,
  userId: id,
  displayName: z.string().min(1).max(80),
  role: z.enum(['owner', 'member']),
  // Sent with memberships, so a person in several households can tell them apart.
  householdName: z.string().min(1).max(80).optional(),
});
export const favoriteSchema = z.strictObject({
  householdId: id,
  listingId: id,
  userId: id,
  /** When this member favorited the listing; independent of source observations. */
  savedAt: timestamp,
});
// A listing hidden for the whole household, by the member who hid it last.
export const hideSchema = z.strictObject({
  listingId: id,
  userId: id,
  hiddenAt: timestamp,
});
// One member's note on one listing, as the snapshot carries it.
export const snapshotNoteSchema = z.strictObject({
  listingId: id,
  userId: id,
  body: z.string().max(2000),
  revision: z.number().int().positive(),
  /** Time of this member edit, independent of collector refreshes. */
  editedAt: timestamp,
});
export const neighborhoodSchema = z.strictObject({
  /** Official Göteborg primärområde code, prefixed for a stable application identity. */
  id: z.string().regex(/^goteborg-\d{3}$/),
  name: z.string().min(1).max(100),
  /** Point containment or buffer intersection against the official polygons. */
  method: z.literal('polygon'),
  /** Boundary release used for assignment, not the time the listing was scanned. */
  datasetVersion: z.literal('goteborg-primary-areas-2025'),
});
export const listingSchema = z.strictObject({
  id,
  householdId: id,
  origin: z.enum(['source', 'manual', 'synthetic']),
  // The catalog source of a source listing. Absent on manual listings and in older snapshots.
  sourceId: sourceId.optional(),
  title: z.string().min(1).max(200),
  sourceUrls: z.array(listingUrlSchema).min(1).max(20),
  facts: factsSchema,
  conflicts: z.array(factsSchema.keyof()).max(20),
  coordinates: coordinateSchema.nullable(),
  evidence: z.array(evidenceSchema).max(50),
  photo: photoSchema.nullable(),
  // Every photo, the lead one first. Only manual links carry several; absent means just `photo`.
  photos: z.array(photoSchema).max(10).optional(),
  /** Previous comparable, undisputed asking price in this source episode; unknown prices break the chain. */
  previousAskingPriceSek: money.positive().nullable(),
  /** Latest accepted collector observation time; not discovery, change or broker publication time. */
  observedAt: timestamp,
  addedBy: id.nullable(),
  userTags: z.array(z.string().max(40)).max(10),
  /** Legacy primary point-containing area; use candidates when present, even if empty. */
  neighborhood: neighborhoodSchema.optional(),
  /** All official areas intersecting the point/buffer. Optional for older snapshots; [] means unassigned. */
  neighborhoodCandidates: z.array(neighborhoodSchema).max(96).optional(),
  /** Heuristic browsing radius in local metres: source point 0, address estimate 50, street estimate 250. Not measured accuracy. */
  neighborhoodRadiusM: z
    .union([z.literal(0), z.literal(50), z.literal(250)])
    .optional(),
  /** Stable server discovery time for this episode; null when retained history cannot establish it. */
  firstSeenAt: timestamp.nullable().optional(),
  /** Server time of the latest meaningful revision; refreshes, viewings and retention cleanup do not advance it. */
  lastChangedAt: timestamp.nullable().optional(),
  /** Server time a newer observation was accepted, including unchanged content. */
  lastCheckedAt: timestamp.optional(),
  /** When the listing went missing from two full reads of its source in a row. Absent while listed. */
  delistedAt: timestamp.optional(),
  /** First found in this source's latest successful/partial published run. Not an unread flag. */
  isNew: z.boolean().optional(),
  // Future viewings the policy allows, sorted. Left out when there are none.
  viewings: z.array(viewingSchema).max(10).optional(),
});
export const snapshotSchema = z.strictObject({
  contractVersion: z.literal(CONTRACT_VERSION),
  householdId: id,
  edition: z
    .strictObject({
      id,
      /** Server publication time of the collected edition, not an individual broker listing. */
      publishedAt: timestamp,
      coverage: z.enum(['synthetic', 'partial', 'complete']),
      sourceSummary: z.string().max(1000),
    })
    .nullable(),
  members: z.array(memberSchema).max(10),
  profiles: z.array(profileSchema).max(20),
  listings: z.array(listingSchema).max(1500),
  favorites: z.array(favoriteSchema).max(5000),
  // The household's hidden listings, each with the member and time of its latest hide. Left out when
  // there are none.
  hides: z.array(hideSchema).max(1500).optional(),
  // Every member's notes on the listings above, so opening a listing needs no request. Ten members on
  // 500 listings is the ceiling. The database leaves the key out when there are none; absent means none.
  notes: z.array(snapshotNoteSchema).max(5000).optional(),
});
export const manualSubmissionSchema = z.strictObject({
  url: listingUrlSchema,
  title: z.string().trim().max(200),
  note: z.string().trim().max(2000),
  // Photo addresses to hotlink, first one leads.
  imageUrls: z
    .array(
      listingUrlSchema.refine(
        (value) => value.startsWith('https://'),
        'validation.photoLinksMustStartWithHttps',
      ),
    )
    .max(10),
  // What the member knows; null for the rest.
  facts: factsSchema.pick({
    propertyType: true,
    askingPriceSek: true,
    livingAreaM2: true,
    rooms: true,
    outdoor: true,
  }),
});
// What a member can change on a manual listing; the link stays as it was added.
export const manualEditSchema = manualSubmissionSchema.pick({
  title: true,
  imageUrls: true,
  facts: true,
});
export const ingestRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('begin'),
    contractVersion: z.literal(CONTRACT_VERSION),
    runId: id,
    // Ignored since the shared catalog; accepted until every collector stops sending it.
    profileVersions: z
      .array(
        z.strictObject({
          profileId: id,
          revision: z.number().int().positive(),
        }),
      )
      .min(1)
      .max(20)
      .optional(),
    sourceIds: z
      .array(z.string().regex(/^[a-z0-9-]{1,60}$/))
      .min(1)
      .max(20),
  }),
  z.strictObject({
    action: z.literal('stage'),
    contractVersion: z.literal(CONTRACT_VERSION),
    runId: id,
    batchId: id,
    sourceId: z.string().regex(/^[a-z0-9-]{1,60}$/),
    observations: z.array(observationSchema).max(100),
  }),
  z.strictObject({
    action: z.literal('publish'),
    contractVersion: z.literal(CONTRACT_VERSION),
    runId: id,
    results: z
      .array(
        z.strictObject({
          sourceId: z.string().regex(/^[a-z0-9-]{1,60}$/),
          status: z.enum(['success', 'partial', 'failed']),
          coverageNote: z.string().max(1000),
          cursor: z.string().max(2000).nullable(),
          // True when every search page was read to its end and reached the source's own total.
          fullRead: z.boolean().optional(),
          // Every home on the search pages, including those the collector bounds drop.
          seen: z
            .array(
              z.strictObject({
                sourceListingId: z.string().min(1).max(200),
                episodeId: z.string().min(1).max(200),
              }),
            )
            .max(2000)
            .optional(),
        }),
      )
      .min(1)
      .max(20),
  }),
]);
export const annotationSchema = z.strictObject({
  listingId: id,
  evidenceIds: z.array(id).min(1).max(20),
  provider: z.string().max(80),
  model: z.string().max(80),
  promptVersion: z.string().max(80),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  profileId: id,
  profileRevision: z.number().int().positive(),
  summary: z.string().max(1000),
  state: z.enum(['completed', 'deferred', 'invalidated']),
});
export type Criteria = z.infer<typeof criteriaSchema>;
export type SearchProfile = z.infer<typeof profileSchema>;
export type Viewing = z.infer<typeof viewingSchema>;
export type Listing = z.infer<typeof listingSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Favorite = z.infer<typeof favoriteSchema>;
export type SnapshotNote = z.infer<typeof snapshotNoteSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
export type SourcePolicy = z.infer<typeof sourcePolicySchema>;
export type IngestRequest = z.infer<typeof ingestRequestSchema>;
export type ManualSubmission = z.infer<typeof manualSubmissionSchema>;
export type ManualEdit = z.infer<typeof manualEditSchema>;
export const NO_MANUAL_FACTS: ManualSubmission['facts'] = {
  propertyType: null,
  askingPriceSek: null,
  livingAreaM2: null,
  rooms: null,
  outdoor: null,
};
