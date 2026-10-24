import balcony from '@/features/house-scanner/mock/assets/balcony.svg?no-inline';
import floorPlan from '@/features/house-scanner/mock/assets/floor-plan.svg?no-inline';
import kitchen from '@/features/house-scanner/mock/assets/kitchen.svg?no-inline';
import livingRoom from '@/features/house-scanner/mock/assets/living-room.svg?no-inline';
import { snapshotSchema } from '@/features/house-scanner/types/contracts';
import {
  type ListingNote,
  NoteConflictError,
} from '@/features/house-scanner/types/notes';

export const DEMO_HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000002';
export const DEMO_OTHER_USER_ID = '00000000-0000-4000-8000-000000000003';
const date = '2026-10-12T10:00:00Z';
export const STALE_LISTING_ID = '00000000-0000-4000-8000-000000000014';
const demoPhotos = [livingRoom, kitchen, balcony].map((url) => ({
  url: new URL(url, globalThis.location?.origin ?? 'http://localhost').href,
  attribution: 'Shellter demo illustration',
  rightsBasis: 'Original illustration included with Shellter',
  expiresAt: '2099-01-01T00:00:00Z',
  observedAt: date,
  displayAllowed: true,
  hotlinkAllowed: true,
}));
const demoFloorPlan = {
  ...demoPhotos[0],
  url: new URL(floorPlan, globalThis.location?.origin ?? 'http://localhost')
    .href,
};
const baseFacts = {
  propertyType: 'apartment',
  tenure: 'cooperative',
  purchase: true,
  livingAreaM2: 80,
  secondaryAreaM2: null,
  rooms: 3,
  askingPriceSek: 2800000,
  groundFloor: false,
  lift: true,
  liftServesHome: true,
  stepFree: null,
  outdoor: 'balcony',
  glazed: true,
  largePrivateTerrace: null,
  municipality: 'Example municipality',

  baseFeeSek: 4000,
  mandatoryMonthlySek: null,
  status: 'available',
};
export const SYNTHETIC_SNAPSHOT = snapshotSchema.parse({
  contractVersion: 1,
  householdId: DEMO_HOUSEHOLD_ID,
  edition: {
    id: '00000000-0000-4000-8000-000000000004',
    publishedAt: date,
    coverage: 'synthetic',
    sourceSummary: 'Fictional examples. No live sources or verified coverage.',
  },
  members: [
    {
      householdId: DEMO_HOUSEHOLD_ID,
      userId: DEMO_USER_ID,
      displayName: 'Demo Alex',
      role: 'owner',
    },
    {
      householdId: DEMO_HOUSEHOLD_ID,
      userId: DEMO_OTHER_USER_ID,
      displayName: 'Demo Morgan',
      role: 'member',
    },
  ],
  profiles: [
    {
      id: '00000000-0000-4000-8000-000000000005',
      householdId: DEMO_HOUSEHOLD_ID,
      revision: 1,
      name: 'Fictional demonstration profile',
      enabled: true,
      editedBy: DEMO_USER_ID,
      editedAt: date,
      criteria: {
        minAreaM2: 60,
        maxAreaM2: 100,
        minRooms: 2,
        preferredPriceSek: 3000000,
        stretchPriceSek: 3500000,
        propertyTypes: ['apartment', 'house'],
        excludeGroundFloor: true,
        requireLift: true,
        requireOutdoor: true,
        preferGlazing: true,
        feeReferenceSek: 5000,
        geography: {
          municipalities: ['Example municipality'],
          center: [11.97, 57.71],
          radiusKm: 20,
        },
        nature: { preferImmediateGreenery: true, preferredWalkMinutes: 15 },
        transit: {
          preferredWalkMinutes: 10,
          preferredJourneyMinutes: 30,
          tradeoffJourneyMinutes: 45,
        },
      },
    },
  ],
  listings: [
    {
      id: '00000000-0000-4000-8000-000000000010',
      title: 'Example balcony home',
      firstSeenAt: date,
      lastChangedAt: date,
      lastCheckedAt: date,
      isNew: true,
      neighborhood: {
        id: 'goteborg-102',
        name: 'Sanna',
        method: 'polygon',
        datasetVersion: 'goteborg-primary-areas-2025',
      },
      facts: baseFacts,
      coordinates: {
        longitude: 11.97,
        latitude: 57.71,
        precision: 'building',
        source: 'Fictional demo pin',
        observedAt: date,
      },
      previousAskingPriceSek: 2900000,
    },
    {
      id: '00000000-0000-4000-8000-000000000011',
      title: 'Example terrace home',
      facts: {
        ...baseFacts,
        outdoor: 'terrace',
        glazed: false,
        largePrivateTerrace: true,
        askingPriceSek: 3200000,
      },
      coordinates: {
        longitude: 11.975,
        latitude: 57.714,
        precision: 'approximate_area',
        source: 'Fictional demo area',
        observedAt: date,
      },
      previousAskingPriceSek: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000012',
      title: 'Example home needing details',
      facts: { ...baseFacts, askingPriceSek: null, lift: null, glazed: null },
      coordinates: null,
      previousAskingPriceSek: null,
      priceEstimate: {
        lowSek: 2_800_000,
        highSek: 3_750_000,
        finalSek: 3_420_000,
        nearby: 6,
        farthestM: 660,
        levelUsed: true,
      },
    },
    {
      id: '00000000-0000-4000-8000-000000000013',
      title: 'Example detached home',
      neighborhood: {
        id: 'goteborg-101',
        name: 'Kungsladugård',
        method: 'polygon',
        datasetVersion: 'goteborg-primary-areas-2025',
      },
      facts: {
        ...baseFacts,
        propertyType: 'house',
        tenure: 'ownership',
        lift: false,
        outdoor: 'none',
        glazed: null,
        baseFeeSek: null,
        livingAreaM2: 95,
      },
      coordinates: {
        longitude: 11.97005,
        latitude: 57.71005,
        precision: 'building',
        source: 'Fictional demo pin',
        observedAt: date,
      },
      previousAskingPriceSek: null,
    },
    {
      // Fictional source listing last seen a week before the edition, so the
      // demo shows the "not seen in the latest scan" notice.
      id: STALE_LISTING_ID,
      title: 'Example older listing',
      origin: 'source',
      observedAt: '2026-10-05T10:00:00Z',
      facts: { ...baseFacts, askingPriceSek: 2600000 },
      coordinates: null,
      previousAskingPriceSek: null,
    },
  ].map((listing) => ({
    householdId: DEMO_HOUSEHOLD_ID,
    origin: 'synthetic',
    observedAt: date,
    ...listing,
    sourceUrls: [`https://example.invalid/homes/${listing.id}`],
    conflicts: [],
    evidence: [],
    photo:
      listing.id === '00000000-0000-4000-8000-000000000010'
        ? demoPhotos[0]
        : null,
    ...(listing.id === '00000000-0000-4000-8000-000000000010'
      ? { photos: demoPhotos, floorPlan: demoFloorPlan }
      : {}),
    addedBy: null,
    userTags: [],
  })),
  favorites: [
    {
      householdId: DEMO_HOUSEHOLD_ID,
      listingId: '00000000-0000-4000-8000-000000000010',
      userId: DEMO_OTHER_USER_ID,
      savedAt: date,
    },
    {
      householdId: DEMO_HOUSEHOLD_ID,
      listingId: STALE_LISTING_ID,
      userId: DEMO_USER_ID,
      savedAt: '2026-10-04T10:00:00Z',
    },
  ],
});

export interface DemoNoteStore {
  list(listingId: string): ListingNote[];
  save(
    userId: string,
    listingId: string,
    body: string,
    revision: number,
  ): number;
}

const SEEDED_NOTES: [string, ListingNote][] = [
  [
    '00000000-0000-4000-8000-000000000010',
    {
      userId: DEMO_OTHER_USER_ID,
      body: 'Fictional note: the balcony faces a courtyard. Ask about the association repair plan.',
      revision: 1,
      editedAt: '2026-10-12T11:30:00Z',
    },
  ],
  [
    '00000000-0000-4000-8000-000000000011',
    {
      userId: DEMO_USER_ID,
      body: 'Fictional note: the terrace is large, but the street side may be loud.',
      revision: 1,
      editedAt: '2026-10-12T11:45:00Z',
    },
  ],
  [
    '00000000-0000-4000-8000-000000000011',
    {
      userId: DEMO_OTHER_USER_ID,
      body: 'Fictional note: worth a second visit in the evening.',
      revision: 2,
      editedAt: '2026-10-12T12:15:00Z',
    },
  ],
];

// One shared note per member and listing, revisioned like hs_save_note.
// Created per demo session, so leaving the demo discards every edit.
export function createDemoNoteStore(seeded = true): DemoNoteStore {
  const notes = new Map<string, ListingNote[]>();
  for (const [listingId, note] of seeded ? SEEDED_NOTES : [])
    notes.set(listingId, [...(notes.get(listingId) ?? []), { ...note }]);
  return {
    list(listingId) {
      return (notes.get(listingId) ?? [])
        .map((note) => ({ ...note }))
        .sort((a, b) => a.editedAt.localeCompare(b.editedAt));
    },
    save(userId, listingId, body, revision) {
      const existing = notes.get(listingId) ?? [];
      const own = existing.find((note) => note.userId === userId);
      const editedAt = new Date().toISOString();
      if (revision === 0 && !own) {
        notes.set(listingId, [
          ...existing,
          { userId, body, revision: 1, editedAt },
        ]);
        return 1;
      }
      if (!own || own.revision !== revision) throw new NoteConflictError();
      own.body = body;
      own.revision += 1;
      own.editedAt = editedAt;
      return own.revision;
    },
  };
}
