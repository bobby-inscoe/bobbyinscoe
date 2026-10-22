import {
  DEMO_HOUSEHOLD_ID,
  DEMO_OTHER_USER_ID,
  DEMO_USER_ID,
  SYNTHETIC_SNAPSHOT,
} from '@/features/house-scanner/mock/synthetic-household';
import type { Listing } from '@/features/house-scanner/types/contracts';

// Test-only v2 replies, shaped as hs_household_snapshot sends them.
const AT = '2026-10-12T10:00:00Z';
const LATER = '2027-10-12T10:00:00Z';
const MANUAL_ID = '00000000-0000-4000-8000-000000000020';
const BARE_MANUAL_ID = '00000000-0000-4000-8000-000000000021';
const area = (id: string, name: string) => ({
  [id]: { name, datasetVersion: 'goteborg-primary-areas-2025' },
});

// The facts a v2 home sends: only those that differ from hs.empty_facts().
function sentFacts(facts: Listing['facts']) {
  return Object.fromEntries(
    Object.entries(facts).filter(
      ([key, value]) =>
        value !== null &&
        !(['tenure', 'status'].includes(key) && value === 'unknown'),
    ),
  );
}

function sourceHome(listing: Listing, index: number) {
  return {
    id: listing.id,
    sourceId: 'demo',
    title: listing.title,
    url: listing.sourceUrls[0],
    facts: sentFacts(listing.facts),
    ...(listing.coordinates ? { coordinates: listing.coordinates } : {}),
    ...(listing.previousAskingPriceSek
      ? { previousAskingPriceSek: listing.previousAskingPriceSek }
      : {}),
    observedAt: listing.observedAt,
    ...(listing.firstSeenAt ? { firstSeenAt: listing.firstSeenAt } : {}),
    ...(listing.lastChangedAt ? { lastChangedAt: listing.lastChangedAt } : {}),
    lastCheckedAt: listing.lastCheckedAt ?? listing.observedAt,
    ...(listing.isNew ? { isNew: true } : {}),
    ...(listing.neighborhood
      ? {
          neighborhoodId: listing.neighborhood.id,
          neighborhoodIds: [listing.neighborhood.id],
          neighborhoodRadiusM: 0,
        }
      : {}),
    // Every branch of the expansion, spread over the five demo homes.
    ...[
      {
        photo: {
          url: `https://example.invalid/${index}.jpg`,
          expiresAt: LATER,
          observedAt: AT,
        },
        viewings: [{ startsAt: LATER, endsAt: null }],
        futureHomeField: 'ignored',
      },
      {
        photo: {
          url: `https://example.invalid/${index}.jpg`,
          expiresAt: LATER,
          observedAt: AT,
          attribution: 'Other broker',
          rightsBasis: 'Other permission',
        },
        conflicts: ['rooms'],
        evidence: [
          {
            id: '00000000-0000-4000-8000-000000000030',
            kind: 'measurement',
            subject: 'transit',
            summary: 'Fictional tram stop distance.',
            sourceUrl: null,
            observedAt: AT,
            datasetVersion: null,
            method: 'straight line',
            value: 320,
            unit: 'metres_straight_line',
          },
        ],
      },
      { neighborhoodIds: [], neighborhoodRadiusM: 250 },
      { delistedAt: AT },
      {},
    ][index % 5],
  };
}

// The demo household as a v2 reply: its five homes as source homes, two manual homes, hides and notes.
export function syntheticV2() {
  const snapshot = SYNTHETIC_SNAPSHOT;
  const listings = snapshot.listings.map(sourceHome);
  return {
    contractVersion: 2,
    householdId: DEMO_HOUSEHOLD_ID,
    futureTopField: 'ignored',
    edition: snapshot.edition,
    members: snapshot.members.map(({ householdId: _, ...member }) => member),
    profiles: snapshot.profiles.map(
      ({ householdId: _, ...profile }) => profile,
    ),
    sources: {
      demo: {
        photoAttribution: 'Demo broker',
        photoRightsBasis: 'Fictional permission',
      },
    },
    neighborhoods: {
      ...area('goteborg-101', 'Kungsladugård'),
      ...area('goteborg-102', 'Sanna'),
    },
    listings: [
      ...listings,
      {
        id: MANUAL_ID,
        origin: 'manual',
        title: 'Example bookmarked home',
        sourceUrls: ['https://example.invalid/bookmark'],
        facts: { rooms: 3, outdoor: 'balcony' },
        photos: [
          { url: 'https://example.invalid/m1.jpg' },
          { url: 'https://example.invalid/m2.jpg' },
        ],
        photoExpiresAt: LATER,
        observedAt: AT,
        lastCheckedAt: AT,
        addedBy: DEMO_USER_ID,
        userTags: ['garden'],
      },
      {
        id: BARE_MANUAL_ID,
        origin: 'manual',
        title: 'Example bare bookmark',
        sourceUrls: ['https://example.invalid/bare'],
        facts: {},
        observedAt: AT,
        lastCheckedAt: AT,
      },
    ],
    favorites: [
      ...snapshot.favorites.map(({ householdId: _, ...favorite }) => favorite),
      { listingId: MANUAL_ID, userId: DEMO_OTHER_USER_ID, savedAt: AT },
    ],
    hides: [{ listingId: listings[2].id, userId: DEMO_USER_ID, hiddenAt: AT }],
    notes: [
      {
        listingId: listings[0].id,
        userId: DEMO_OTHER_USER_ID,
        body: 'Fictional note.',
        revision: 1,
        editedAt: AT,
      },
    ],
  };
}

// A household of `count` source homes, cycling through the demo homes' shapes, for timing.
export function largeV2(count: number) {
  const base = syntheticV2();
  const sources = base.listings.slice(0, 5);
  return {
    ...base,
    listings: Array.from({ length: count }, (_, index) => ({
      ...sources[index % 5],
      id: `30000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    })),
    favorites: [],
    hides: [],
    notes: [],
  };
}
