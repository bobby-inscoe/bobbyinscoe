import { z } from 'zod';
import {
  CONTRACT_VERSION,
  coordinateSchema,
  factsSchema,
  favoriteSchema,
  hideSchema,
  type Listing,
  listingSchema,
  listingUrlSchema,
  memberSchema,
  neighborhoodSchema,
  photoSchema,
  profileSchema,
  type Snapshot,
  snapshotNoteSchema,
  snapshotSchema,
} from '@/features/house-scanner/types/contracts';

// What hs.empty_facts() holds. A v2 home sends only the facts that differ from it.
const EMPTY_FACTS = {
  propertyType: null,
  tenure: 'unknown',
  purchase: null,
  livingAreaM2: null,
  secondaryAreaM2: null,
  rooms: null,
  askingPriceSek: null,
  groundFloor: null,
  lift: null,
  liftServesHome: null,
  stepFree: null,
  outdoor: null,
  glazed: null,
  largePrivateTerrace: null,
  municipality: null,
  baseFeeSek: null,
  mandatoryMonthlySek: null,
  status: 'unknown',
} as const;
const MANUAL_PHOTO = {
  attribution: 'Added by a household member',
  rightsBasis: 'Linked by a household member, not stored.',
};

// The v2 response, checked once with the snapshot's own field schemas, so the expansion below needs no second parse.
// Unknown top-level and per-home keys are dropped rather than refused, so the server can add a field before the
// client reads it.
const timestamp = listingSchema.shape.observedAt;
const v2Home = z.object({
  id: listingSchema.shape.id,
  origin: z.literal('manual').optional(),
  sourceId: listingSchema.shape.sourceId,
  title: listingSchema.shape.title,
  url: listingUrlSchema.optional(),
  sourceUrls: listingSchema.shape.sourceUrls.optional(),
  facts: factsSchema.partial(),
  conflicts: listingSchema.shape.conflicts.optional(),
  coordinates: coordinateSchema.optional(),
  photo: z
    .object({
      url: photoSchema.shape.url,
      expiresAt: timestamp,
      observedAt: timestamp,
      attribution: photoSchema.shape.attribution.optional(),
      rightsBasis: photoSchema.shape.rightsBasis.optional(),
    })
    .optional(),
  photos: z
    .array(z.object({ url: photoSchema.shape.url }))
    .max(10)
    .optional(),
  photoExpiresAt: timestamp.optional(),
  previousAskingPriceSek: listingSchema.shape.previousAskingPriceSek
    .unwrap()
    .optional(),
  observedAt: timestamp,
  firstSeenAt: timestamp.optional(),
  lastChangedAt: timestamp.optional(),
  lastCheckedAt: timestamp.optional(),
  isNew: z.literal(true).optional(),
  delistedAt: timestamp.optional(),
  viewings: listingSchema.shape.viewings,
  evidence: listingSchema.shape.evidence.optional(),
  neighborhoodId: neighborhoodSchema.shape.id.optional(),
  neighborhoodIds: z.array(neighborhoodSchema.shape.id).max(96).optional(),
  neighborhoodRadiusM: listingSchema.shape.neighborhoodRadiusM,
  addedBy: listingSchema.shape.addedBy.unwrap().optional(),
  userTags: listingSchema.shape.userTags.optional(),
});
export const snapshotV2Schema = z.object({
  contractVersion: z.literal(2),
  householdId: snapshotSchema.shape.householdId,
  edition: snapshotSchema.shape.edition,
  members: z
    .array(
      z.object({
        userId: memberSchema.shape.userId,
        displayName: memberSchema.shape.displayName,
        role: memberSchema.shape.role,
      }),
    )
    .max(10),
  profiles: z.array(profileSchema.omit({ householdId: true })).max(20),
  sources: z.record(
    z.string(),
    z.object({
      photoAttribution: photoSchema.shape.attribution,
      photoRightsBasis: photoSchema.shape.rightsBasis,
    }),
  ),
  neighborhoods: z.record(
    neighborhoodSchema.shape.id,
    z.object({
      name: neighborhoodSchema.shape.name,
      datasetVersion: neighborhoodSchema.shape.datasetVersion,
    }),
  ),
  listings: z.array(v2Home).max(1500),
  favorites: z.array(favoriteSchema.omit({ householdId: true })).max(5000),
  hides: z.array(hideSchema).max(1500),
  notes: z.array(snapshotNoteSchema).max(5000),
});
export type SnapshotV2 = z.infer<typeof snapshotV2Schema>;

// A value the reply refers to but does not carry, such as an area missing from `neighborhoods`.
function carried<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('The v2 snapshot refers to a value it does not carry.');
  return value;
}

// The v2 response as the snapshot the app has always used. Throws when a home refers to something the reply lacks.
export function expandSnapshot(v2: SnapshotV2): Snapshot {
  const { householdId } = v2;
  const area = (id: string) => {
    const known = carried(v2.neighborhoods[id]);
    return {
      id,
      name: known.name,
      method: 'polygon' as const,
      datasetVersion: known.datasetVersion,
    };
  };
  const listings = v2.listings.map((home): Listing => {
    const shared = {
      id: home.id,
      householdId,
      title: home.title,
      facts: { ...EMPTY_FACTS, ...home.facts },
      conflicts: home.conflicts ?? [],
      coordinates: home.coordinates ?? null,
      evidence: home.evidence ?? [],
      previousAskingPriceSek: home.previousAskingPriceSek ?? null,
      observedAt: home.observedAt,
      firstSeenAt: home.firstSeenAt ?? null,
      lastChangedAt: home.lastChangedAt ?? null,
      lastCheckedAt: home.lastCheckedAt,
      isNew: home.isNew ?? false,
    };
    if (home.origin === 'manual') {
      const photos = (home.photos ?? []).map(({ url }) => ({
        url,
        ...MANUAL_PHOTO,
        expiresAt: carried(home.photoExpiresAt),
        observedAt: home.observedAt,
        displayAllowed: true as const,
        hotlinkAllowed: true as const,
      }));
      return {
        ...shared,
        origin: 'manual',
        sourceUrls: carried(home.sourceUrls),
        photo: photos[0] ?? null,
        photos,
        addedBy: home.addedBy ?? null,
        userTags: home.userTags ?? [],
      };
    }
    const credit = home.sourceId ? v2.sources[home.sourceId] : undefined;
    return {
      ...shared,
      origin: 'source',
      sourceId: home.sourceId,
      sourceUrls: [carried(home.url)],
      photo: home.photo
        ? {
            url: home.photo.url,
            attribution: carried(
              home.photo.attribution ?? credit?.photoAttribution,
            ),
            rightsBasis: carried(
              home.photo.rightsBasis ?? credit?.photoRightsBasis,
            ),
            expiresAt: home.photo.expiresAt,
            observedAt: home.photo.observedAt,
            displayAllowed: true,
            hotlinkAllowed: true,
          }
        : null,
      addedBy: null,
      userTags: [],
      ...(home.delistedAt ? { delistedAt: home.delistedAt } : {}),
      ...(home.viewings ? { viewings: home.viewings } : {}),
      ...(home.neighborhoodId
        ? { neighborhood: area(home.neighborhoodId) }
        : {}),
      ...(home.neighborhoodIds
        ? { neighborhoodCandidates: home.neighborhoodIds.map(area) }
        : {}),
      ...(home.neighborhoodRadiusM === undefined
        ? {}
        : { neighborhoodRadiusM: home.neighborhoodRadiusM }),
    };
  });
  return {
    contractVersion: CONTRACT_VERSION,
    householdId,
    edition: v2.edition,
    members: v2.members.map((member) => ({ householdId, ...member })),
    profiles: v2.profiles.map((profile) => ({ householdId, ...profile })),
    listings,
    favorites: v2.favorites.map((favorite) => ({ householdId, ...favorite })),
    ...(v2.hides.length ? { hides: v2.hides } : {}),
    ...(v2.notes.length ? { notes: v2.notes } : {}),
  };
}
