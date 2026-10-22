import { z } from 'zod';
import {
  CONTRACT_VERSION,
  type Snapshot,
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
};
const MANUAL_PHOTO = {
  attribution: 'Added by a household member',
  rightsBasis: 'Linked by a household member, not stored.',
};

// The v2 response's structure. Unknown keys are dropped rather than refused, so the server can add a field before the
// client reads it. Values are checked when the expanded snapshot is parsed with snapshotSchema.
const fields = z.record(z.string(), z.unknown());
const v2Home = z.object({
  id: z.string(),
  origin: z.literal('manual').optional(),
  sourceId: z.string().optional(),
  title: z.string(),
  url: z.string().optional(),
  sourceUrls: z.array(z.string()).optional(),
  facts: fields,
  conflicts: z.array(z.string()).optional(),
  coordinates: fields.optional(),
  photo: z
    .object({
      url: z.string(),
      expiresAt: z.string(),
      observedAt: z.string(),
      attribution: z.string().optional(),
      rightsBasis: z.string().optional(),
    })
    .optional(),
  photos: z.array(z.object({ url: z.string() })).optional(),
  photoExpiresAt: z.string().optional(),
  previousAskingPriceSek: z.number().optional(),
  observedAt: z.string(),
  firstSeenAt: z.string().optional(),
  lastChangedAt: z.string().optional(),
  lastCheckedAt: z.string().optional(),
  isNew: z.literal(true).optional(),
  delistedAt: z.string().optional(),
  viewings: z.array(fields).optional(),
  evidence: z.array(fields).optional(),
  neighborhoodId: z.string().optional(),
  neighborhoodIds: z.array(z.string()).optional(),
  neighborhoodRadiusM: z.number().optional(),
  addedBy: z.string().optional(),
  userTags: z.array(z.string()).optional(),
});
export const snapshotV2Schema = z.object({
  contractVersion: z.literal(2),
  householdId: z.string(),
  edition: fields.nullable(),
  members: z.array(
    z.object({ userId: z.string(), displayName: z.string(), role: z.string() }),
  ),
  profiles: z.array(fields),
  sources: z.record(
    z.string(),
    z.object({ photoAttribution: z.string(), photoRightsBasis: z.string() }),
  ),
  neighborhoods: z.record(
    z.string(),
    z.object({ name: z.string(), datasetVersion: z.string() }),
  ),
  listings: z.array(v2Home),
  favorites: z.array(fields),
  hides: z.array(fields),
  notes: z.array(fields),
});
export type SnapshotV2 = z.infer<typeof snapshotV2Schema>;

// The v2 response as the snapshot the app has always used, validated by its schema.
export function expandSnapshot(v2: SnapshotV2): Snapshot {
  const { householdId } = v2;
  const area = (id: string) => ({
    id,
    name: v2.neighborhoods[id]?.name,
    method: 'polygon',
    datasetVersion: v2.neighborhoods[id]?.datasetVersion,
  });
  const listings = v2.listings.map((home) => {
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
        expiresAt: home.photoExpiresAt,
        observedAt: home.observedAt,
        displayAllowed: true,
        hotlinkAllowed: true,
      }));
      return {
        ...shared,
        origin: 'manual',
        sourceUrls: home.sourceUrls,
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
      sourceUrls: [home.url],
      photo: home.photo
        ? {
            url: home.photo.url,
            attribution: home.photo.attribution ?? credit?.photoAttribution,
            rightsBasis: home.photo.rightsBasis ?? credit?.photoRightsBasis,
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
  return snapshotSchema.parse({
    contractVersion: CONTRACT_VERSION,
    householdId,
    edition: v2.edition,
    members: v2.members.map((member) => ({ householdId, ...member })),
    profiles: v2.profiles.map((profile) => ({ householdId, ...profile })),
    listings,
    favorites: v2.favorites.map((favorite) => ({ householdId, ...favorite })),
    ...(v2.hides.length ? { hides: v2.hides } : {}),
    ...(v2.notes.length ? { notes: v2.notes } : {}),
  });
}
