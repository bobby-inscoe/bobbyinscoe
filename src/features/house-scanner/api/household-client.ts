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
      // Email links are read once by consumeAuthRedirect, which also clears them from the address.
      detectSessionInUrl: false,
      flowType: 'implicit',
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
    snapshot.hides?.some(
      (hide) => !listingIds.has(hide.listingId) || !memberIds.has(hide.userId),
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

const token = z.string().regex(/^[a-f0-9]{64}$/);
export const invitationPreviewSchema = z.discriminatedUnion('valid', [
  z.strictObject({ valid: z.literal(false) }),
  z.strictObject({
    valid: z.literal(true),
    purpose: z.enum(['create', 'join']),
    expiresAt: z.string(),
    householdName: z.string().nullable(),
    issuerName: z.string().nullable(),
  }),
]);
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
export const householdAccessSchema = z.strictObject({
  name: z.string(),
  members: z
    .array(
      z.strictObject({
        userId: z.uuid(),
        displayName: z.string(),
        role: z.enum(['owner', 'member']),
        active: z.boolean(),
      }),
    )
    .max(10),
  invitations: z
    .array(
      z.strictObject({
        id: z.uuid(),
        email: z.string(),
        createdAt: z.string(),
        expiresAt: z.string(),
      }),
    )
    .max(100),
});
export type HouseholdAccess = z.infer<typeof householdAccessSchema>;

// The database's reasons a person can act on; anything else stays a generic failure.
const ACCESS_ERRORS: Record<string, string> = {
  'Make another member an owner before leaving':
    'Make another member an owner before leaving.',
  'Household member limit reached': 'This household already has ten members.',
  'Membership limit reached': 'You already belong to ten households.',
  'Already a member': 'You are already a member of this household.',
  'Invitation unavailable':
    'This invitation has expired, been used or revoked, or was sent to a different email. Ask for a fresh link.',
  'Confirm your email before accepting': 'Confirm your email before accepting.',
  'Invalid email': 'Enter a valid email address.',
  'Invalid name': 'Enter a name of 1 to 80 characters.',
};
async function accessRpc<T>(
  client: SupabaseClient,
  name: string,
  args: Record<string, string | null>,
  schema: z.ZodType<T>,
) {
  const { data, error } = await client.rpc(name, args);
  if (error)
    throw new Error(
      ACCESS_ERRORS[error.message] ??
        'The household request failed. Reload and try again.',
    );
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error('The server returned an unsupported household response.');
  return parsed.data;
}

export function invitationUrl(value: string) {
  return `${window.location.origin}/projects/house-scanner/invite?token=${token.parse(value)}`;
}
export async function createInvitation(
  client: SupabaseClient,
  householdId: string,
  purpose: 'create' | 'join',
  email: string | null = null,
) {
  const created = await accessRpc(
    client,
    'hs_invitation_create',
    {
      p_purpose: purpose,
      p_household_id: z.uuid().parse(householdId),
      p_email: email,
    },
    z.strictObject({ id: z.uuid(), token, expiresAt: z.string() }),
  );
  return invitationUrl(created.token);
}
// Makes a link for this email and has the trusted server email it. Returns the link so the sender can copy it too.
export async function sendInvitation(
  client: SupabaseClient,
  householdId: string,
  purpose: 'create' | 'join',
  email: string,
) {
  const url = await createInvitation(client, householdId, purpose, email);
  try {
    await invokeInvite(
      client,
      token.parse(new URL(url).searchParams.get('token')),
      email,
    );
  } catch {
    throw new Error('The invitation email could not be sent. Try again.');
  }
  return url;
}
export function previewInvitation(client: SupabaseClient, value: string) {
  return accessRpc(
    client,
    'hs_invitation_preview',
    { p_token: token.parse(value) },
    invitationPreviewSchema,
  );
}
// Asks the trusted server to reserve the link for this email, then to create the account when there is a password or
// to mail the link when there is not.
export async function invokeInvite(
  client: SupabaseClient,
  value: string,
  email: string,
  password?: string,
) {
  const body = {
    token: token.parse(value),
    email: z.email().max(254).parse(email.trim()),
    ...(password === undefined ? {} : { password }),
  };
  const { error } = await client.functions.invoke('house-scanner-invite', {
    body,
  });
  if (error)
    throw new Error(
      'This invitation cannot be used with that email. Check the address or ask for a fresh link.',
    );
}
export async function redeemInvitation(
  client: SupabaseClient,
  value: string,
  householdName: string | null,
  displayName: string,
) {
  const result = await accessRpc(
    client,
    'hs_invitation_redeem',
    {
      p_token: token.parse(value),
      p_household_name: householdName,
      p_display_name: displayName,
    },
    z.strictObject({ householdId: z.uuid() }),
  );
  return result.householdId;
}
export function householdAccess(client: SupabaseClient, householdId: string) {
  return accessRpc(
    client,
    'hs_household_access',
    { p_household_id: z.uuid().parse(householdId) },
    householdAccessSchema,
  );
}
const ok = z.strictObject({ ok: z.literal(true) });
export function revokeInvitation(
  client: SupabaseClient,
  householdId: string,
  invitationId: string,
) {
  return accessRpc(
    client,
    'hs_invitation_revoke',
    {
      p_household_id: z.uuid().parse(householdId),
      p_invitation_id: z.uuid().parse(invitationId),
    },
    ok,
  );
}
export function renameHousehold(
  client: SupabaseClient,
  householdId: string,
  name: string,
) {
  return accessRpc(
    client,
    'hs_household_rename',
    { p_household_id: z.uuid().parse(householdId), p_name: name },
    ok,
  );
}
export function makeOwner(
  client: SupabaseClient,
  householdId: string,
  userId: string,
) {
  return accessRpc(
    client,
    'hs_member_make_owner',
    {
      p_household_id: z.uuid().parse(householdId),
      p_user_id: z.uuid().parse(userId),
    },
    ok,
  );
}
export function deactivateMember(
  client: SupabaseClient,
  householdId: string,
  userId: string,
) {
  return accessRpc(
    client,
    'hs_member_deactivate',
    {
      p_household_id: z.uuid().parse(householdId),
      p_user_id: z.uuid().parse(userId),
    },
    ok,
  );
}
export function leaveHousehold(client: SupabaseClient, householdId: string) {
  return accessRpc(
    client,
    'hs_household_leave',
    { p_household_id: z.uuid().parse(householdId) },
    z.strictObject({ archived: z.boolean() }),
  );
}

// Invitation and recovery emails return with the session in the address hash. It is read once, moved into the
// client, and removed from the address and history. Returns which kind of link it was.
export async function consumeAuthRedirect(
  client: SupabaseClient,
): Promise<'invite' | 'recovery' | 'error' | null> {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const access = params.get('access_token');
  const refresh = params.get('refresh_token');
  if (!access && !params.get('error')) return null;
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
  if (!access || !refresh) return 'error';
  const { error } = await client.auth.setSession({
    access_token: access,
    refresh_token: refresh,
  });
  if (error) return 'error';
  const type = params.get('type');
  return type === 'recovery' ? 'recovery' : type === 'invite' ? 'invite' : null;
}
