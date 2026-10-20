import { vi } from 'vitest';

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
  data: { user: { id: string } | null };
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
    getUser: vi.fn<() => Promise<UserReply>>(),
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
export function fixtureSnapshot(): Snapshot {
  const snapshot = structuredClone(SYNTHETIC_SNAPSHOT);
  snapshot.edition = null;
  for (const listing of snapshot.listings) listing.origin = 'manual';
  return snapshot;
}
export function userReply(id: string | null = USER_ID): UserReply {
  return { data: { user: id ? { id } : null }, error: null };
}
export function reply(data: unknown): Reply {
  return { data, error: null };
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
  sdk.auth.getUser.mockReset().mockResolvedValue(userReply());
  sdk.auth.signOut.mockReset().mockResolvedValue({ error: null });
  sdk.auth.signInWithPassword.mockClear();
  sdk.auth.setSession.mockClear();
  sdk.auth.resetPasswordForEmail.mockClear();
  sdk.auth.updateUser.mockClear();
  sdk.functions.invoke.mockClear();
  sdk.rpc.mockReset().mockImplementation(async (name) => {
    if (name === 'hs_memberships') return reply([fixtureSnapshot().members[0]]);
    if (name === 'hs_snapshot' || name === 'hs_snapshot_neighborhoods')
      return reply(fixtureSnapshot());
    return reply({ ok: true });
  });
}
