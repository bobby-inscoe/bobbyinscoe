import { vi } from 'vitest';

import {
  expandSnapshot,
  snapshotV2Schema,
} from '@/features/house-scanner/api/snapshot-v2';
import {
  DEMO_HOUSEHOLD_ID,
  DEMO_OTHER_USER_ID,
  DEMO_USER_ID,
  SYNTHETIC_SNAPSHOT,
} from '@/features/house-scanner/mock/synthetic-household';
import type { Snapshot } from '@/features/house-scanner/types/contracts';

export const HOUSEHOLD_ID = DEMO_HOUSEHOLD_ID;
export const USER_ID = DEMO_USER_ID;
export const OTHER_USER_ID = DEMO_OTHER_USER_ID;
export const OTHER_HOUSEHOLD_ID = '00000000-0000-4000-8000-000000000099';
export const AUTH_KEY = 'house-scanner.auth.localhost:54321';

type AuthListener = (
  event: string,
  session: { user: { id: string } } | null,
) => void;
export type Reply = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
type UserReply = {
  data: { session: { user: { id: string } } | null };
  error: { message: string } | null;
};
type AuthStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};
let listener: AuthListener | null = null;
export const sdk = {
  auth: {
    getSession: vi.fn<() => Promise<UserReply>>(),
    onAuthStateChange: vi.fn((callback: AuthListener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    signOut: vi.fn<() => Promise<{ error: { message: string } | null }>>(),
    signInWithPassword: vi.fn(
      async (_credentials: { email: string; password: string }) => ({
        error: null as { message: string } | null,
      }),
    ),
    setSession: vi.fn(
      async (_tokens: { access_token: string; refresh_token: string }) => ({
        error: null as { message: string } | null,
      }),
    ),
    resetPasswordForEmail: vi.fn(
      async (_email: string, _options: { redirectTo: string }) => ({
        error: null as { message: string } | null,
      }),
    ),
    updateUser: vi.fn(async (_changes: { password: string }) => ({
      error: null as { message: string } | null,
    })),
  },
  functions: {
    invoke: vi.fn(async (_name: string, _options: { body: object }) => ({
      error: null as { message: string } | null,
    })),
  },
  rpc: vi.fn<(name: string, args: object) => Promise<Reply>>(),
};
export let sdkStorage: AuthStorage;
export let sdkStorageKey: string;
export const createClient = vi.fn(
  (
    _url: string,
    _key: string,
    options: { auth: { storage: AuthStorage; storageKey: string } },
  ) => {
    sdkStorage = options.auth.storage;
    sdkStorageKey = options.auth.storageKey;
    return sdk;
  },
);
// A snapshot as the read model would send it in v2. Every photo carries its own credit, so `sources` stays empty.
export function toV2(snapshot: Snapshot) {
  const areas: Record<string, { name: string; datasetVersion: string }> = {};
  const listings = snapshot.listings.map((listing) => {
    const facts = Object.fromEntries(
      Object.entries(listing.facts).filter(
        ([key, value]) =>
          value !== null &&
          !(['tenure', 'status'].includes(key) && value === 'unknown'),
      ),
    );
    const times = {
      observedAt: listing.observedAt,
      ...(listing.firstSeenAt ? { firstSeenAt: listing.firstSeenAt } : {}),
      ...(listing.lastChangedAt
        ? { lastChangedAt: listing.lastChangedAt }
        : {}),
      ...(listing.lastCheckedAt
        ? { lastCheckedAt: listing.lastCheckedAt }
        : {}),
    };
    if (listing.origin === 'manual') {
      const photos = listing.photos ?? (listing.photo ? [listing.photo] : []);
      return {
        id: listing.id,
        origin: 'manual',
        title: listing.title,
        sourceUrls: listing.sourceUrls,
        facts,
        ...(photos.length
          ? {
              photos: photos.map(({ url }) => ({ url })),
              photoExpiresAt: photos[0].expiresAt,
            }
          : {}),
        ...times,
        ...(listing.addedBy ? { addedBy: listing.addedBy } : {}),
        ...(listing.userTags.length ? { userTags: listing.userTags } : {}),
      };
    }
    for (const area of [
      ...(listing.neighborhood ? [listing.neighborhood] : []),
      ...(listing.neighborhoodCandidates ?? []),
    ])
      areas[area.id] = { name: area.name, datasetVersion: area.datasetVersion };
    return {
      id: listing.id,
      sourceId: listing.sourceId ?? 'demo',
      title: listing.title,
      url: listing.sourceUrls[0],
      facts,
      ...(listing.conflicts.length ? { conflicts: listing.conflicts } : {}),
      ...(listing.coordinates ? { coordinates: listing.coordinates } : {}),
      ...(listing.photo
        ? {
            photo: {
              url: listing.photo.url,
              expiresAt: listing.photo.expiresAt,
              observedAt: listing.photo.observedAt,
              attribution: listing.photo.attribution,
              rightsBasis: listing.photo.rightsBasis,
            },
          }
        : {}),
      ...(listing.previousAskingPriceSek
        ? { previousAskingPriceSek: listing.previousAskingPriceSek }
        : {}),
      ...times,
      ...(listing.isNew ? { isNew: true } : {}),
      ...(listing.delistedAt ? { delistedAt: listing.delistedAt } : {}),
      ...(listing.viewings ? { viewings: listing.viewings } : {}),
      ...(listing.evidence.length ? { evidence: listing.evidence } : {}),
      ...(listing.neighborhood
        ? { neighborhoodId: listing.neighborhood.id }
        : {}),
      ...(listing.neighborhoodCandidates
        ? {
            neighborhoodIds: listing.neighborhoodCandidates.map(({ id }) => id),
          }
        : {}),
      ...(listing.neighborhoodRadiusM === undefined
        ? {}
        : { neighborhoodRadiusM: listing.neighborhoodRadiusM }),
    };
  });
  return {
    contractVersion: 2,
    householdId: snapshot.householdId,
    edition: snapshot.edition,
    members: snapshot.members.map(({ userId, displayName, role }) => ({
      userId,
      displayName,
      role,
    })),
    profiles: snapshot.profiles.map(
      ({ householdId: _, ...profile }) => profile,
    ),
    sources: {},
    neighborhoods: areas,
    listings,
    favorites: snapshot.favorites.map(
      ({ householdId: _, ...favorite }) => favorite,
    ),
    hides: snapshot.hides ?? [],
    notes: snapshot.notes ?? [],
  };
}
// The demo household as the client builds it from the read model, with every home a member's link.
export function fixtureSnapshot(): Snapshot {
  const snapshot = structuredClone(SYNTHETIC_SNAPSHOT);
  snapshot.edition = null;
  for (const listing of snapshot.listings) listing.origin = 'manual';
  return expandSnapshot(snapshotV2Schema.parse(toV2(snapshot)));
}
// hs_household_start's reply for a member of one household.
export function startReply(
  snapshot: Snapshot = fixtureSnapshot(),
  members = [fixtureSnapshot().members[0]],
): Reply {
  return reply({ memberships: members, snapshot: toV2(snapshot) });
}
// A v2 snapshot with one source home, as hs_household_snapshot sends it.
export function v2Snapshot() {
  const member = fixtureSnapshot().members.find(
    (entry) => entry.userId === USER_ID,
  );
  return {
    contractVersion: 2,
    householdId: HOUSEHOLD_ID,
    edition: null,
    members: [
      { userId: USER_ID, displayName: member?.displayName, role: 'owner' },
    ],
    profiles: [],
    sources: {},
    neighborhoods: {},
    listings: [
      {
        id: '30000000-0000-4000-8000-000000000001',
        sourceId: 'alpha',
        title: 'Read model home',
        url: 'https://example.invalid/home',
        facts: { rooms: 2 },
        observedAt: '2026-10-22T10:00:00+00:00',
        lastCheckedAt: '2026-10-22T10:00:00+00:00',
      },
    ],
    favorites: [],
    hides: [],
    notes: [],
  };
}
export function userReply(id: string | null = USER_ID): UserReply {
  return { data: { session: id ? { user: { id } } : null }, error: null };
}
export function reply(data: unknown): Reply {
  return { data, error: null };
}
// The reply for a database function that is not installed.
export function missing(): Reply {
  return {
    data: null,
    error: { code: 'PGRST202', message: 'Function missing' },
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export function emitAuth(event: string, id: string | null = USER_ID) {
  if (!listener) throw new Error('Hook has not subscribed to auth changes.');
  listener(event, id ? { user: { id } } : null);
}
export function resetSdk() {
  listener = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubEnv('VITE_HOUSE_SCANNER_ENABLED', 'true');
  vi.stubEnv('VITE_HOUSE_SCANNER_SUPABASE_URL', 'http://localhost:54321');
  vi.stubEnv(
    'VITE_HOUSE_SCANNER_SUPABASE_PUBLISHABLE_KEY',
    'sb_publishable_synthetic_test_only_12345',
  );
  sdk.auth.getSession.mockReset().mockResolvedValue(userReply());
  sdk.auth.signOut.mockReset().mockResolvedValue({ error: null });
  sdk.auth.signInWithPassword.mockClear();
  sdk.auth.setSession.mockClear();
  sdk.auth.resetPasswordForEmail.mockClear();
  sdk.auth.updateUser.mockClear();
  sdk.functions.invoke.mockClear();
  sdk.rpc.mockReset().mockImplementation(async (name) => {
    if (name === 'hs_household_start') return startReply();
    if (name === 'hs_household_snapshot') return reply(toV2(fixtureSnapshot()));
    return reply({ ok: true });
  });
}
