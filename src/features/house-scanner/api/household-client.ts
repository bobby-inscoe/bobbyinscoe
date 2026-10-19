import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  type ManualSubmission,
  type Member,
  manualSubmissionSchema,
  memberSchema,
  profileSchema,
  type SearchProfile,
  snapshotSchema,
} from '@/features/house-scanner/types/contracts';
import {
  NOTE_MAX_LENGTH,
  NoteConflictError,
} from '@/features/house-scanner/types/notes';

const STORAGE_PREFIX = 'house-scanner.auth.';
const REMEMBER_KEY = 'house-scanner.remember';
const settingsSchema = z.strictObject({
  url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname)))
    );
  }),
  key: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]{20,}$/),
});
export function privateBackendSettings() {
  if (import.meta.env.VITE_HOUSE_SCANNER_ENABLED !== 'true') return null;
  const settings = settingsSchema.safeParse({
    url: import.meta.env.VITE_HOUSE_SCANNER_SUPABASE_URL,
    key: import.meta.env.VITE_HOUSE_SCANNER_SUPABASE_PUBLISHABLE_KEY,
  });
  return settings.success ? settings.data : null;
}
export function clearOwnedSessionStorage() {
  let failed = false;
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = window[name];
      for (const key of Object.keys(storage))
        if (key.startsWith(STORAGE_PREFIX)) storage.removeItem(key);
      storage.removeItem(REMEMBER_KEY);
    } catch {
      failed = true;
    }
  }
  if (failed)
    throw new Error(
      'Browser storage could not be cleared. Close this tab and clear site data.',
    );
}
let sharedClient: SupabaseClient | null = null;
export function createHouseholdClient() {
  const settings = privateBackendSettings();
  if (!settings) return null;
  for (const store of [window.localStorage, window.sessionStorage]) {
    const probe = 'house-scanner.storage-check';
    store.setItem(probe, '1');
    store.removeItem(probe);
  }
  if (sharedClient) return sharedClient;
  // The preference chooses the SDK store; neither the preference nor storage authorizes access.
  const storage = {
    getItem(key: string) {
      const remember =
        (window.sessionStorage.getItem(REMEMBER_KEY) ??
          window.localStorage.getItem(REMEMBER_KEY)) === 'true';
      return (remember ? window.localStorage : window.sessionStorage).getItem(
        key,
      );
    },
    setItem(key: string, value: string) {
      const remember =
        (window.sessionStorage.getItem(REMEMBER_KEY) ??
          window.localStorage.getItem(REMEMBER_KEY)) === 'true';
      (remember ? window.localStorage : window.sessionStorage).setItem(
        key,
        value,
      );
    },
    removeItem(key: string) {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    },
  };
  sharedClient = createClient(settings.url, settings.key, {
    auth: {
      storage,
      storageKey: `${STORAGE_PREFIX}${new URL(settings.url).host}`,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: { headers: { 'X-Client-Info': 'house-scanner-browser' } },
  });
  return sharedClient;
}
export function setRememberDevice(remember: boolean) {
  clearOwnedSessionStorage();
  window.sessionStorage.setItem(REMEMBER_KEY, String(remember));
  if (remember) window.localStorage.setItem(REMEMBER_KEY, 'true');
}
const okSchema = z.strictObject({ ok: z.literal(true) });
const revisionSchema = z.strictObject({
  revision: z.number().int().positive(),
});
const manualResultSchema = z.strictObject({
  listingId: z.uuid(),
  existing: z.boolean(),
});
async function rpc<T>(
  client: SupabaseClient,
  name: string,
  args: Record<string, string | number | boolean | object>,
  schema: z.ZodType<T>,
  fallback?: string,
) {
  let { data, error } = await client.rpc(name, args);
  // Older deployments can serve the unchanged snapshot while the migration rolls out.
  if (fallback && error && ['PGRST202', '42883'].includes(error.code))
    ({ data, error } = await client.rpc(fallback, args));
  if (error) {
    // 40001 is the server's revision-conflict code; only a note save treats it as recoverable.
    if (name === 'hs_save_note' && error.code === '40001')
      throw new NoteConflictError();
    throw new Error('The household request failed. Reload and try again.');
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error('The server returned an unsupported household response.');
  return parsed.data;
}
export function memberships(client: SupabaseClient) {
  return rpc(client, 'hs_memberships', {}, z.array(memberSchema).max(10));
}
export async function householdSnapshot(
  client: SupabaseClient,
  householdId: string,
  userId: string,
  // Memberships the caller fetched moments ago in the same refresh; hs_snapshot re-checks on the server.
  fetched?: Member[],
) {
  const current = fetched ?? (await memberships(client));
  if (
    !current.some((m) => m.householdId === householdId && m.userId === userId)
  )
    throw new Error('Your household access is no longer active.');
  const snapshot = await rpc(
    client,
    'hs_snapshot_neighborhoods',
    { p_household_id: householdId },
    snapshotSchema,
    'hs_snapshot',
  );
  const memberIds = new Set(snapshot.members.map((member) => member.userId));
  const listingIds = new Set(snapshot.listings.map((listing) => listing.id));
  if (
    snapshot.householdId !== householdId ||
    !memberIds.has(userId) ||
    snapshot.members.some((member) => member.householdId !== householdId) ||
    snapshot.profiles.some((profile) => profile.householdId !== householdId) ||
    snapshot.listings.some(
      (listing) =>
        listing.householdId !== householdId || listing.origin === 'synthetic',
    ) ||
    snapshot.favorites.some(
      (favorite) =>
        favorite.householdId !== householdId ||
        !listingIds.has(favorite.listingId) ||
        !memberIds.has(favorite.userId),
    ) ||
    snapshot.hiddenListingIds?.some(
      (listingId) => !listingIds.has(listingId),
    ) ||
    snapshot.notes?.some(
      (note) => !listingIds.has(note.listingId) || !memberIds.has(note.userId),
    ) ||
    listingIds.size !== snapshot.listings.length ||
    memberIds.size !== snapshot.members.length
  )
    throw new Error('The server returned inconsistent household data.');
  return snapshot;
}
export function setFavorite(
  client: SupabaseClient,
  householdId: string,
  listingId: string,
  saved: boolean,
) {
  return rpc(
    client,
    'hs_set_favorite',
    {
      p_household_id: z.uuid().parse(householdId),
      p_listing_id: z.uuid().parse(listingId),
      p_saved: saved,
    },
    okSchema,
  );
}
export function setHidden(
  client: SupabaseClient,
  householdId: string,
  listingIds: string[],
  hidden: boolean,
) {
  return rpc(
    client,
    'hs_set_hidden',
    {
      p_household_id: z.uuid().parse(householdId),
      p_listing_ids: z.array(z.uuid()).min(1).max(500).parse(listingIds),
      p_hidden: hidden,
    },
    okSchema,
  );
}
export function addManual(
  client: SupabaseClient,
  householdId: string,
  submission: ManualSubmission,
) {
  const value = manualSubmissionSchema.parse(submission);
  const url = new URL(value.url);
  for (const key of [...url.searchParams.keys()])
    if (/^(utm_|fbclid$|gclid$|msclkid$)/i.test(key))
      url.searchParams.delete(key);
  return rpc(
    client,
    'hs_add_manual',
    {
      p_household_id: householdId,
      p_url: url.href,
      p_title: value.title,
      p_note: value.note,
      p_tags: value.tags,
    },
    manualResultSchema,
  );
}
export function saveProfile(
  client: SupabaseClient,
  householdId: string,
  profile: SearchProfile,
) {
  const value = profileSchema.parse(profile);
  if (value.householdId !== householdId)
    throw new Error('Profile belongs to another household.');
  return rpc(
    client,
    'hs_save_profile',
    {
      p_household_id: householdId,
      p_profile_id: value.id,
      p_revision: value.revision,
      p_name: value.name,
      p_enabled: value.enabled,
      p_criteria: value.criteria,
    },
    revisionSchema,
  );
}
export function saveNote(
  client: SupabaseClient,
  householdId: string,
  listingId: string,
  body: string,
  revision: number,
) {
  return rpc(
    client,
    'hs_save_note',
    {
      p_household_id: householdId,
      p_listing_id: listingId,
      p_body: z.string().max(NOTE_MAX_LENGTH).parse(body),
      p_revision: z.number().int().nonnegative().parse(revision),
    },
    revisionSchema,
  );
}
