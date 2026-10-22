import { describe, expect, it } from 'vitest';
import {
  expandSnapshot,
  snapshotV2Schema,
} from '@/features/house-scanner/api/snapshot-v2';

const HOUSE = '10000000-0000-4000-8000-000000000001';
const USER = '20000000-0000-4000-8000-000000000001';
const PLAIN = '30000000-0000-4000-8000-000000000001';
const CREDITED = '30000000-0000-4000-8000-000000000002';
const MANUAL = '30000000-0000-4000-8000-000000000003';
const AT = '2026-10-22T10:00:00.123456+00:00';
const LATER = '2027-10-22T10:00:00.123456+00:00';

// A v2 response as the database sends it, with a key from a newer server at the top and on a home.
const response = {
  contractVersion: 2,
  householdId: HOUSE,
  addedLater: true,
  edition: null,
  members: [{ userId: USER, displayName: 'Synthetic owner', role: 'owner' }],
  profiles: [],
  sources: {
    alpha: {
      photoAttribution: 'Alpha broker',
      photoRightsBasis: 'Synthetic permission',
    },
  },
  neighborhoods: {
    'goteborg-107': {
      name: 'Haga',
      datasetVersion: 'goteborg-primary-areas-2025',
    },
  },
  listings: [
    {
      id: PLAIN,
      sourceId: 'alpha',
      title: 'Plain',
      url: 'https://example.invalid/plain',
      facts: { rooms: 2, tenure: 'cooperative' },
      observedAt: AT,
      lastCheckedAt: AT,
      futureField: 'ignored',
    },
    {
      id: CREDITED,
      sourceId: 'alpha',
      title: 'Credited',
      url: 'https://example.invalid/credited',
      facts: {},
      conflicts: ['rooms'],
      coordinates: {
        longitude: 11.95,
        latitude: 57.7,
        precision: 'address',
        source: 'Synthetic',
        observedAt: AT,
      },
      photo: {
        url: 'https://example.invalid/a.jpg',
        expiresAt: LATER,
        observedAt: AT,
      },
      previousAskingPriceSek: 2_500_000,
      observedAt: AT,
      firstSeenAt: AT,
      lastChangedAt: AT,
      lastCheckedAt: AT,
      isNew: true,
      delistedAt: AT,
      viewings: [{ startsAt: LATER, endsAt: null }],
      neighborhoodId: 'goteborg-107',
      neighborhoodIds: ['goteborg-107'],
      neighborhoodRadiusM: 0,
    },
    {
      id: MANUAL,
      origin: 'manual',
      title: 'Bookmark',
      sourceUrls: ['https://example.invalid/bookmark'],
      facts: { rooms: 3 },
      photos: [
        { url: 'https://example.invalid/1.jpg' },
        { url: 'https://example.invalid/2.jpg' },
      ],
      photoExpiresAt: LATER,
      observedAt: AT,
      lastCheckedAt: AT,
      addedBy: USER,
      userTags: ['garden'],
    },
  ],
  favorites: [{ listingId: PLAIN, userId: USER, savedAt: AT }],
  hides: [],
  notes: [],
};

describe('snapshot v2 expansion', () => {
  const snapshot = expandSnapshot(snapshotV2Schema.parse(response));
  const home = (id: string) =>
    snapshot.listings.find((listing) => listing.id === id);

  it('fills the household, the empty facts and the defaults of a source home', () => {
    expect(snapshot.members).toEqual([
      {
        householdId: HOUSE,
        userId: USER,
        displayName: 'Synthetic owner',
        role: 'owner',
      },
    ]);
    expect(snapshot.favorites[0].householdId).toBe(HOUSE);
    expect(home(PLAIN)).toEqual({
      id: PLAIN,
      householdId: HOUSE,
      origin: 'source',
      sourceId: 'alpha',
      title: 'Plain',
      sourceUrls: ['https://example.invalid/plain'],
      facts: expect.objectContaining({
        rooms: 2,
        tenure: 'cooperative',
        status: 'unknown',
        askingPriceSek: null,
      }),
      conflicts: [],
      coordinates: null,
      evidence: [],
      photo: null,
      previousAskingPriceSek: null,
      observedAt: AT,
      firstSeenAt: null,
      lastChangedAt: null,
      lastCheckedAt: AT,
      isNew: false,
      addedBy: null,
      userTags: [],
    });
  });

  it('adds the source credit to a photo and rebuilds the areas', () => {
    expect(home(CREDITED)).toMatchObject({
      photo: {
        url: 'https://example.invalid/a.jpg',
        attribution: 'Alpha broker',
        rightsBasis: 'Synthetic permission',
        expiresAt: LATER,
        observedAt: AT,
        displayAllowed: true,
        hotlinkAllowed: true,
      },
      isNew: true,
      delistedAt: AT,
      neighborhoodRadiusM: 0,
    });
    const area = {
      id: 'goteborg-107',
      name: 'Haga',
      method: 'polygon',
      datasetVersion: 'goteborg-primary-areas-2025',
    };
    expect(home(CREDITED)?.neighborhood).toEqual(area);
    expect(home(CREDITED)?.neighborhoodCandidates).toEqual([area]);
  });

  it('keeps a photo’s own credit when it differs from its source', () => {
    const own = structuredClone(response);
    Object.assign(own.listings[1].photo ?? {}, {
      attribution: 'Other broker',
      rightsBasis: 'Other permission',
    });
    const photo = expandSnapshot(snapshotV2Schema.parse(own)).listings.find(
      (listing) => listing.id === CREDITED,
    )?.photo;
    expect(photo).toMatchObject({
      attribution: 'Other broker',
      rightsBasis: 'Other permission',
    });
  });

  it('rebuilds a manual home’s photos with the household credit', () => {
    const manual = home(MANUAL);
    expect(manual?.origin).toBe('manual');
    expect(manual?.photos?.map((photo) => photo.url)).toEqual([
      'https://example.invalid/1.jpg',
      'https://example.invalid/2.jpg',
    ]);
    expect(manual?.photo).toEqual(manual?.photos?.[0]);
    expect(manual?.photo).toMatchObject({
      attribution: 'Added by a household member',
      expiresAt: LATER,
      observedAt: AT,
    });
    expect(manual).toMatchObject({ addedBy: USER, userTags: ['garden'] });
    expect(manual?.sourceId).toBeUndefined();
  });

  it('drops unknown keys and leaves out empty hides and notes, as the old snapshot did', () => {
    expect(snapshot).not.toHaveProperty('addedLater');
    expect(home(PLAIN)).not.toHaveProperty('futureField');
    expect(snapshot.hides).toBeUndefined();
    expect(snapshot.notes).toBeUndefined();
  });

  it('refuses values the snapshot schema refuses', () => {
    const bad = structuredClone(response);
    bad.listings[0].url = 'javascript:alert(1)';
    expect(() => expandSnapshot(snapshotV2Schema.parse(bad))).toThrow();
  });
});
