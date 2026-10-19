import { z } from 'zod';

import {
  memberSchema,
  snapshotSchema,
} from '@/features/house-scanner/types/contracts';
import { noteSchema } from '@/features/house-scanner/types/notes';
import type { ApiResult, Caller, Gateway } from './gateway';

export type Status = 'PASS' | 'FAIL' | 'SKIPPED';
export interface CheckResult {
  id: string;
  title: string;
  status: Status;
  /** What a PASS establishes, in one line. */
  meaning: string;
  /** Observed statuses, codes and messages. Never credentials or ids. */
  observations: string[];
  durationMs: number;
}
export interface RunOptions {
  a2Provided: boolean;
  a2Deactivated: boolean;
}

// The one code the app's client reacts to (household-client.ts, hs_save_note).
export const STALE_REVISION_CODE = '40001';
const NIL_UUID = '00000000-0000-4000-8000-000000000000';
export const ACCEPTANCE_URL_PREFIX =
  'https://example.invalid/house-scanner-acceptance/';
const NOTE_BODIES = [
  'FICTIONAL acceptance note, first save',
  'FICTIONAL acceptance note, second save',
  'FICTIONAL acceptance note, concurrent save one',
  'FICTIONAL acceptance note, concurrent save two',
] as const;

// Argument names must match the migrations; a unit test compares them. A wrong
// name makes PostgREST answer "function not found", which looks like a denial.
export const PUBLIC_RPC_PROBES: Record<string, Record<string, unknown>> = {
  hs_memberships: {},
  hs_snapshot: { p_household_id: NIL_UUID },
  hs_set_favorite: {
    p_household_id: NIL_UUID,
    p_listing_id: NIL_UUID,
    p_saved: true,
  },
  hs_add_manual: {
    p_household_id: NIL_UUID,
    p_url: `${ACCEPTANCE_URL_PREFIX}probe`,
    p_title: 'FICTIONAL probe',
    p_note: '',
    p_tags: [],
  },
  hs_notes: { p_household_id: NIL_UUID, p_listing_id: NIL_UUID },
  hs_save_note: {
    p_household_id: NIL_UUID,
    p_listing_id: NIL_UUID,
    p_body: 'FICTIONAL probe',
    p_revision: 0,
  },
  hs_save_profile: {
    p_household_id: NIL_UUID,
    p_profile_id: NIL_UUID,
    p_revision: 1,
    p_name: 'FICTIONAL probe',
    p_enabled: true,
    p_criteria: {},
  },
};
// Granted to service_role only: neither anon nor authenticated may run them.
export const SERVICE_RPC_PROBES: Record<string, Record<string, unknown>> = {
  hs_purge_expired: { p_household_id: NIL_UUID, p_limit: 1, p_dry_run: true },
  hs_ingest_credential: { p_key_id: 'accept-probe' },
  hs_consume_nonce: {
    p_key_id: 'accept-probe',
    p_nonce: 'accept-probe',
    p_timestamp: 0,
  },
  hs_ingest_policies: { p_key_id: 'accept-probe' },
  hs_ingest: {
    p_key_id: 'accept-probe',
    p_body_hash: '0'.repeat(64),
    p_request: {},
  },
};
// Invalid arguments on purpose: if one ever ran it would raise and write nothing.
export const ADMIN_PROBES: Record<string, Record<string, unknown>> = {
  admin_bootstrap_household: {
    p_name: 'FICTIONAL probe',
    p_owner_user_id: NIL_UUID,
    p_owner_name: 'FICTIONAL probe',
    p_profile_name: 'FICTIONAL probe',
    p_criteria: {},
  },
  admin_set_member: {
    p_household_id: NIL_UUID,
    p_user_id: NIL_UUID,
    p_display_name: 'FICTIONAL probe',
    p_role: 'member',
    p_active: true,
  },
  admin_set_source_policy: { p_household_id: NIL_UUID, p_policy: {} },
  admin_issue_credential: {
    p_household_id: NIL_UUID,
    p_key_id: 'accept-probe',
    p_source_ids: ['accept-probe'],
    p_expires_at: '2000-01-01T00:00:00Z',
  },
  admin_revoke_credential: { p_key_id: 'accept-probe' },
};

export function describeResult(result: ApiResult): string {
  if (!result.error) return `status ${result.status}, no error`;
  const message = result.error.message.slice(0, 120);
  return `status ${result.status}, code ${result.error.code || 'none'}, message "${message}"`;
}

// The request was refused before any function body ran: a missing privilege,
// an unexposed schema or an unknown function. A function that ran and raised
// its own error is not a refusal here, because it means the grant exists.
export function isBlocked(result: ApiResult): boolean {
  const error = result.error;
  if (!error || result.data !== null) return false;
  return (
    /permission denied/i.test(error.message) ||
    error.code.startsWith('PGRST') ||
    result.status === 401
  );
}
// The household functions' own refusal for a caller who is not an active member.
export function isHouseholdDenied(result: ApiResult): boolean {
  return (
    result.error?.code === '42501' &&
    /household access denied/i.test(result.error.message) &&
    result.data === null
  );
}

interface Session {
  caller: Caller;
  userId: string;
}
interface Context {
  a?: Session;
  a2?: Session;
  b?: Session;
  householdA?: string;
  householdB?: string;
  listingA?: string;
  listingB?: string;
  /** Revision of A's note after the round trip, when known. */
  noteRevision?: number;
  noteTouched: boolean;
  favoriteTouched: boolean;
}
interface Outcome {
  status: Status;
  observations: string[];
}
const pass = (observations: string[] = []): Outcome => ({
  status: 'PASS',
  observations,
});
const fail = (observations: string[]): Outcome => ({
  status: 'FAIL',
  observations,
});
const skip = (reason: string): Outcome => ({
  status: 'SKIPPED',
  observations: [reason],
});

const okSchema = z.object({ ok: z.literal(true) });
const revisionSchema = z.object({ revision: z.number().int().positive() });
const manualSchema = z.object({ listingId: z.uuid(), existing: z.boolean() });
const membershipsSchema = z.array(memberSchema);
const notesSchema = z.array(noteSchema);
type Note = z.infer<typeof noteSchema>;

function leaks(results: ApiResult[], secrets: string[]): boolean {
  const text = results.map((r) => JSON.stringify(r.data ?? null)).join('\n');
  return secrets.some((secret) => secret && text.includes(secret));
}

async function setup(gateway: Gateway, ctx: Context): Promise<Outcome> {
  const notes: string[] = [];
  const a = await gateway.signIn('A');
  const b = await gateway.signIn('B');
  if (!a.ok || !b.ok)
    return fail([
      `user A: ${a.ok ? 'signed in' : a.message}`,
      `user B: ${b.ok ? 'signed in' : b.message}`,
    ]);
  ctx.a = a;
  ctx.b = b;
  const a2 = await gateway.signIn('A2');
  if (a2.ok) ctx.a2 = a2;
  else if (!/No credentials/.test(a2.message))
    notes.push(`user A2: ${a2.message}`);
  for (const [label, session] of [
    ['A', a],
    ['B', b],
  ] as const) {
    const memberships = await session.caller.rpc('hs_memberships', {});
    const parsed = membershipsSchema.safeParse(memberships.data);
    if (!parsed.success || parsed.data.length === 0)
      return fail([
        ...notes,
        `user ${label}: no household found (${describeResult(memberships)}). Run the seed SQL first.`,
      ]);
    const householdId = parsed.data[0].householdId;
    const added = await session.caller.rpc('hs_add_manual', {
      p_household_id: householdId,
      p_url: `${ACCEPTANCE_URL_PREFIX}${label.toLowerCase()}`,
      p_title: `FICTIONAL acceptance listing ${label}`,
      p_note: '',
      p_tags: [],
    });
    const listing = manualSchema.safeParse(added.data);
    if (!listing.success)
      return fail([
        ...notes,
        `user ${label}: hs_add_manual failed (${describeResult(added)})`,
      ]);
    if (label === 'A') {
      ctx.householdA = householdId;
      ctx.listingA = listing.data.listingId;
    } else {
      ctx.householdB = householdId;
      ctx.listingB = listing.data.listingId;
    }
    notes.push(
      `household ${label}: listing ${listing.data.existing ? 'already present' : 'created'} through hs_add_manual`,
    );
  }
  if (ctx.householdA === ctx.householdB)
    return fail([...notes, 'users A and B resolve to the same household.']);
  return pass(notes);
}

async function anonDenied(gateway: Gateway): Promise<Outcome> {
  const anon = gateway.anon();
  const observations: string[] = [];
  let failed = false;
  const probes = { ...PUBLIC_RPC_PROBES, ...SERVICE_RPC_PROBES };
  for (const [name, args] of Object.entries(probes)) {
    const result = await anon.rpc(name, args);
    const blocked = isBlocked(result);
    failed ||= !blocked;
    observations.push(
      `${blocked ? 'blocked' : 'NOT BLOCKED'} ${name}: ${describeResult(result)}`,
    );
  }
  for (const [table, schema] of [
    ['members', 'hs'],
    ['households', 'hs'],
    ['members', 'public'],
  ] as const) {
    const result = await anon.readTable(table, schema);
    const blocked = result.error !== null && result.data === null;
    failed ||= !blocked;
    observations.push(
      `${blocked ? 'blocked' : 'NOT BLOCKED'} read ${schema}.${table}: ${describeResult(result)}`,
    );
  }
  return failed ? fail(observations) : pass(observations);
}

async function userASnapshot(ctx: Context): Promise<Outcome> {
  const { a, householdA } = ctx;
  if (!a || !householdA) return skip('setup did not complete');
  const memberships = await a.caller.rpc('hs_memberships', {});
  const parsed = membershipsSchema.safeParse(memberships.data);
  if (!parsed.success || parsed.data.length !== 1)
    return fail([
      `hs_memberships: ${describeResult(memberships)}, expected exactly one household`,
    ]);
  if (parsed.data[0].householdId !== householdA)
    return fail(['hs_memberships changed between calls']);
  const observations = ['hs_memberships returned exactly one household'];
  const snapshot = await a.caller.rpc('hs_snapshot', {
    p_household_id: householdA,
  });
  if (snapshot.error) return fail([`hs_snapshot: ${describeResult(snapshot)}`]);
  const contract = snapshotSchema.safeParse(snapshot.data);
  if (!contract.success)
    return fail([
      `hs_snapshot did not satisfy the app contract: ${contract.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; ')}`,
    ]);
  const data = contract.data;
  const foreign =
    data.householdId !== householdA ||
    data.listings.some((l) => l.householdId !== householdA) ||
    data.members.some((m) => m.householdId !== householdA) ||
    data.profiles.some((p) => p.householdId !== householdA);
  if (foreign) return fail(['hs_snapshot contains rows of another household']);
  if (!data.listings.some((l) => l.id === ctx.listingA))
    return fail(['hs_snapshot does not list the listing added in setup']);
  observations.push(
    `hs_snapshot accepted: contractVersion ${data.contractVersion}, ${data.listings.length} listing(s), ${data.members.length} member(s), ${data.profiles.length} profile(s)`,
  );
  return pass(observations);
}

async function crossHousehold(ctx: Context): Promise<Outcome> {
  const { b, householdA, householdB, listingA } = ctx;
  if (!b || !householdA || !householdB || !listingA)
    return skip('setup did not complete');
  const observations: string[] = [];
  const results: ApiResult[] = [];
  let failed = false;
  const expectDenied = async (label: string, call: Promise<ApiResult>) => {
    const result = await call;
    results.push(result);
    const denied = isHouseholdDenied(result);
    failed ||= !denied;
    observations.push(
      `${denied ? 'denied' : 'NOT DENIED'} ${label}: ${describeResult(result)}`,
    );
  };
  const household = { p_household_id: householdA };
  const listing = { ...household, p_listing_id: listingA };
  await expectDenied(
    'hs_snapshot of household A',
    b.caller.rpc('hs_snapshot', household),
  );
  await expectDenied(
    'hs_notes of household A',
    b.caller.rpc('hs_notes', listing),
  );
  await expectDenied(
    'hs_set_favorite in household A',
    b.caller.rpc('hs_set_favorite', { ...listing, p_saved: true }),
  );
  await expectDenied(
    'hs_save_note in household A',
    b.caller.rpc('hs_save_note', {
      ...listing,
      p_body: NOTE_BODIES[0],
      p_revision: 0,
    }),
  );
  // Own household with a foreign listing id: no data may come back and no write may succeed.
  const own = { p_household_id: householdB, p_listing_id: listingA };
  const ownNotes = await b.caller.rpc('hs_notes', own);
  results.push(ownNotes);
  const empty =
    !ownNotes.error &&
    Array.isArray(ownNotes.data) &&
    ownNotes.data.length === 0;
  failed ||= !empty;
  observations.push(
    `${empty ? 'empty' : 'NOT EMPTY'} hs_notes of A's listing through household B: ${describeResult(ownNotes)}`,
  );
  const writes: [string, Promise<ApiResult>][] = [
    [
      "hs_set_favorite of A's listing through household B",
      b.caller.rpc('hs_set_favorite', { ...own, p_saved: true }),
    ],
    [
      "hs_save_note on A's listing through household B",
      b.caller.rpc('hs_save_note', {
        ...own,
        p_body: NOTE_BODIES[0],
        p_revision: 0,
      }),
    ],
  ];
  for (const [label, call] of writes) {
    const result = await call;
    results.push(result);
    const refused = result.error !== null;
    failed ||= !refused;
    observations.push(
      `${refused ? 'refused' : 'ACCEPTED'} ${label}: ${describeResult(result)}`,
    );
  }
  const snapshot = await b.caller.rpc('hs_snapshot', {
    p_household_id: householdB,
  });
  results.push(snapshot);
  const parsed = snapshotSchema.safeParse(snapshot.data);
  if (!parsed.success) {
    failed = true;
    observations.push(
      `own hs_snapshot for user B failed: ${describeResult(snapshot)}`,
    );
  }
  results.push(await b.caller.rpc('hs_memberships', {}));
  if (leaks(results, [householdA, listingA, ctx.a?.userId ?? ''])) {
    failed = true;
    observations.push(
      'LEAK: a response to user B contained an identifier of household A.',
    );
  } else
    observations.push(
      'no identifier of household A appeared in any response to user B',
    );
  return failed ? fail(observations) : pass(observations);
}

async function hasFavorite(
  caller: Caller,
  household: string,
  listing: string,
  userId: string,
) {
  const snapshot = await caller.rpc('hs_snapshot', {
    p_household_id: household,
  });
  const parsed = snapshotSchema.safeParse(snapshot.data);
  if (!parsed.success) return null;
  return parsed.data.favorites.some(
    (f) => f.listingId === listing && f.userId === userId,
  );
}

async function currentNote(
  caller: Caller,
  household: string,
  listing: string,
  userId: string,
): Promise<{ result: ApiResult; own: Note | null }> {
  const result = await caller.rpc('hs_notes', {
    p_household_id: household,
    p_listing_id: listing,
  });
  const parsed = notesSchema.safeParse(result.data);
  const own = parsed.success
    ? (parsed.data.find((n) => n.userId === userId) ?? null)
    : null;
  return { result, own };
}

async function roundTrip(ctx: Context): Promise<Outcome> {
  const { a, householdA, listingA } = ctx;
  if (!a || !householdA || !listingA) return skip('setup did not complete');
  const target = { p_household_id: householdA, p_listing_id: listingA };
  ctx.favoriteTouched = true;
  const on = await a.caller.rpc('hs_set_favorite', {
    ...target,
    p_saved: true,
  });
  if (!okSchema.safeParse(on.data).success)
    return fail([`favorite on: ${describeResult(on)}`]);
  if ((await hasFavorite(a.caller, householdA, listingA, a.userId)) !== true)
    return fail(['favorite on: the snapshot does not show the favorite']);
  const off = await a.caller.rpc('hs_set_favorite', {
    ...target,
    p_saved: false,
  });
  if (!okSchema.safeParse(off.data).success)
    return fail([`favorite off: ${describeResult(off)}`]);
  if ((await hasFavorite(a.caller, householdA, listingA, a.userId)) !== false)
    return fail(['favorite off: the snapshot still shows the favorite']);
  const observations = ['favorite on then off, each confirmed in the snapshot'];

  const before = await currentNote(a.caller, householdA, listingA, a.userId);
  if (before.result.error)
    return fail([`hs_notes: ${describeResult(before.result)}`]);
  const start = before.own?.revision ?? 0;
  ctx.noteTouched = true;
  const first = await a.caller.rpc('hs_save_note', {
    ...target,
    p_body: NOTE_BODIES[0],
    p_revision: start,
  });
  const firstRevision = revisionSchema.safeParse(first.data);
  if (!firstRevision.success)
    return fail([`note save at revision ${start}: ${describeResult(first)}`]);
  const second = await a.caller.rpc('hs_save_note', {
    ...target,
    p_body: NOTE_BODIES[1],
    p_revision: firstRevision.data.revision,
  });
  const secondRevision = revisionSchema.safeParse(second.data);
  if (!secondRevision.success)
    return fail([
      `note save at revision ${firstRevision.data.revision}: ${describeResult(second)}`,
    ]);
  ctx.noteRevision = secondRevision.data.revision;
  if (secondRevision.data.revision !== firstRevision.data.revision + 1)
    return fail([
      `revision went ${firstRevision.data.revision} to ${secondRevision.data.revision}, expected one more`,
    ]);
  const after = await currentNote(a.caller, householdA, listingA, a.userId);
  if (
    after.own?.body !== NOTE_BODIES[1] ||
    after.own.revision !== secondRevision.data.revision
  )
    return fail(['hs_notes does not show the last saved body and revision']);
  observations.push(
    `note saved at revision ${start} (${start === 0 ? 'insert' : 'update of an earlier run'}), then at ${firstRevision.data.revision}; now revision ${secondRevision.data.revision}`,
  );
  return pass(observations);
}

async function staleShape(ctx: Context): Promise<Outcome> {
  const { a, householdA, listingA, noteRevision } = ctx;
  if (!a || !householdA || !listingA) return skip('setup did not complete');
  if (noteRevision === undefined || noteRevision < 2)
    return skip('the round trip left no earlier revision to reuse');
  const stale = await a.caller.rpc('hs_save_note', {
    p_household_id: householdA,
    p_listing_id: listingA,
    p_body: NOTE_BODIES[0],
    p_revision: noteRevision - 1,
  });
  const line = `stale hs_save_note: ${describeResult(stale)}`;
  if (stale.error?.code === STALE_REVISION_CODE)
    return pass([
      line,
      `code is '${STALE_REVISION_CODE}', which the app client turns into a note conflict`,
    ]);
  return fail([line, `the app client expects code '${STALE_REVISION_CODE}'`]);
}

async function concurrentSave(
  gateway: Gateway,
  ctx: Context,
): Promise<Outcome> {
  const { a, householdA, listingA } = ctx;
  if (!a || !householdA || !listingA) return skip('setup did not complete');
  if (ctx.noteRevision === undefined)
    return skip('the round trip did not complete');
  const second = await gateway.signIn('A');
  if (!second.ok)
    return skip(`a second session for user A failed: ${second.message}`);
  const before = await currentNote(a.caller, householdA, listingA, a.userId);
  if (!before.own)
    return fail(['the note is missing before the concurrent save']);
  const revision = before.own.revision;
  const base = {
    p_household_id: householdA,
    p_listing_id: listingA,
    p_revision: revision,
  };
  ctx.noteTouched = true;
  const [one, two] = await Promise.all([
    a.caller.rpc('hs_save_note', { ...base, p_body: NOTE_BODIES[2] }),
    second.caller.rpc('hs_save_note', { ...base, p_body: NOTE_BODIES[3] }),
  ]);
  const observations = [
    `session 1: ${describeResult(one)}`,
    `session 2: ${describeResult(two)}`,
  ];
  const wins = [one, two].filter(
    (r) => revisionSchema.safeParse(r.data).success,
  );
  const stale = [one, two].filter((r) => r.error?.code === STALE_REVISION_CODE);
  if (wins.length !== 1 || stale.length !== 1)
    return fail([
      ...observations,
      `expected one winner and one '${STALE_REVISION_CODE}', saw ${wins.length} winner(s) and ${stale.length} stale`,
    ]);
  const winnerBody = wins[0] === one ? NOTE_BODIES[2] : NOTE_BODIES[3];
  const after = await currentNote(a.caller, householdA, listingA, a.userId);
  if (after.own?.revision !== revision + 1 || after.own.body !== winnerBody)
    return fail([
      ...observations,
      'the final note does not match the winning save',
    ]);
  return pass([
    ...observations,
    `final revision ${revision + 1} matches the winner. One attempt is evidence, not proof.`,
  ]);
}

async function privilegedDenied(ctx: Context): Promise<Outcome> {
  const { a, householdA } = ctx;
  if (!a || !householdA) return skip('setup did not complete');
  const observations: string[] = [];
  let failed = false;
  const record = (label: string, result: ApiResult) => {
    const blocked = isBlocked(result);
    failed ||= !blocked;
    observations.push(
      `${blocked ? 'blocked' : 'NOT BLOCKED'} ${label}: ${describeResult(result)}`,
    );
  };
  for (const [name, args] of Object.entries(SERVICE_RPC_PROBES)) {
    // Dry run with the caller's own household, so a leaked grant changes nothing.
    const probe =
      name === 'hs_purge_expired'
        ? { ...args, p_household_id: householdA }
        : args;
    record(name, await a.caller.rpc(name, probe));
  }
  for (const [name, args] of Object.entries(ADMIN_PROBES)) {
    record(`hs.${name} (hs schema)`, await a.caller.rpcInHsSchema(name, args));
    record(`${name} (public schema)`, await a.caller.rpc(name, args));
  }
  const log = await a.caller.readTable('admin_log', 'hs');
  const logBlocked = log.error !== null && log.data === null;
  failed ||= !logBlocked;
  observations.push(
    `${logBlocked ? 'blocked' : 'NOT BLOCKED'} read hs.admin_log: ${describeResult(log)}`,
  );
  return failed ? fail(observations) : pass(observations);
}

async function deactivatedMember(
  ctx: Context,
  options: RunOptions,
): Promise<Outcome> {
  if (!options.a2Provided) return skip('no user A2 credentials were provided');
  if (!options.a2Deactivated)
    return skip('--a2-deactivated was not given, so A2 is assumed active');
  const { a2, householdA, listingA } = ctx;
  if (!a2 || !householdA || !listingA) return skip('user A2 could not sign in');
  const observations: string[] = [];
  let failed = false;
  const listing = { p_household_id: householdA, p_listing_id: listingA };
  const calls: [string, Promise<ApiResult>][] = [
    [
      'hs_snapshot',
      a2.caller.rpc('hs_snapshot', { p_household_id: householdA }),
    ],
    ['hs_notes', a2.caller.rpc('hs_notes', listing)],
    [
      'hs_set_favorite',
      a2.caller.rpc('hs_set_favorite', { ...listing, p_saved: true }),
    ],
    [
      'hs_save_note',
      a2.caller.rpc('hs_save_note', {
        ...listing,
        p_body: NOTE_BODIES[0],
        p_revision: 0,
      }),
    ],
  ];
  for (const [name, call] of calls) {
    const result = await call;
    const denied = isHouseholdDenied(result);
    failed ||= !denied;
    observations.push(
      `${denied ? 'denied' : 'NOT DENIED'} ${name}: ${describeResult(result)}`,
    );
  }
  const memberships = await a2.caller.rpc('hs_memberships', {});
  observations.push(
    `hs_memberships, recorded only: ${describeResult(memberships)}`,
  );
  return failed ? fail(observations) : pass(observations);
}

async function cleanup(ctx: Context): Promise<Outcome> {
  const { a, householdA, listingA } = ctx;
  if (!a || !householdA || !listingA) return skip('nothing was created');
  const observations: string[] = [];
  let failed = false;
  if (ctx.favoriteTouched) {
    const off = await a.caller.rpc('hs_set_favorite', {
      p_household_id: householdA,
      p_listing_id: listingA,
      p_saved: false,
    });
    failed ||= off.error !== null;
    observations.push(`favorite removed: ${describeResult(off)}`);
  }
  if (ctx.noteTouched) {
    const current = await currentNote(a.caller, householdA, listingA, a.userId);
    if (current.own) {
      const cleared = await a.caller.rpc('hs_save_note', {
        p_household_id: householdA,
        p_listing_id: listingA,
        p_body: '',
        p_revision: current.own.revision,
      });
      failed ||= cleared.error !== null;
      observations.push(`note body cleared: ${describeResult(cleared)}`);
    }
  }
  observations.push(
    "left behind: one manual listing per household (example.invalid link) and user A's note row with an empty body. The API has no delete for either; remove them as the operator if wanted.",
  );
  return failed ? fail(observations) : pass(observations);
}

interface CheckSpec {
  id: string;
  title: string;
  meaning: string;
  run: () => Promise<Outcome>;
}

export function buildChecks(
  gateway: Gateway,
  options: RunOptions,
): CheckSpec[] {
  const ctx: Context = { noteTouched: false, favoriteTouched: false };
  return [
    {
      id: '0-setup',
      title: 'Sign in users and prepare one listing per household',
      meaning:
        'Real password sign-in works and each household has a listing to test with.',
      run: () => setup(gateway, ctx),
    },
    {
      id: '1-anon-denied',
      title: 'The publishable key alone gets nothing',
      meaning:
        'Without a session every public hs_* function and the hs schema refuse the request.',
      run: () => anonDenied(gateway),
    },
    {
      id: '2-user-a-snapshot',
      title: 'User A sees exactly household A, in contract shape',
      meaning:
        'hs_memberships and hs_snapshot work through PostgREST and the app contract parser accepts the result.',
      run: () => userASnapshot(ctx),
    },
    {
      id: '3-cross-household',
      title: 'User B cannot read or write household A',
      meaning:
        'Real RLS and membership checks hold across households, and no identifier of A leaks.',
      run: () => crossHousehold(ctx),
    },
    {
      id: '4-round-trip',
      title: 'Favorite and note round trip as user A',
      meaning:
        'Writes persist, show in the snapshot and advance the note revision by one.',
      run: () => roundTrip(ctx),
    },
    {
      id: '4b-stale-error-shape',
      title: 'A stale note save returns the code the app expects',
      meaning:
        "The real error carries code '40001', so the app shows its conflict path instead of a generic failure.",
      run: () => staleShape(ctx),
    },
    {
      id: '5-concurrent-save',
      title: 'Two sessions save the same note revision at once',
      meaning:
        'One save wins and the other gets the stale-revision error (one attempt only).',
      run: () => concurrentSave(gateway, ctx),
    },
    {
      id: '6-privileged-denied',
      title: 'Signed-in users cannot reach operator or service functions',
      meaning:
        'hs_purge_expired, the ingest functions and every hs.admin_* function are unreachable from the API as a member.',
      run: () => privilegedDenied(ctx),
    },
    {
      id: '7-deactivated-member',
      title: 'A deactivated member is locked out',
      meaning:
        'After the operator deactivates user A2, reads and writes in household A are refused.',
      run: () => deactivatedMember(ctx, options),
    },
    {
      id: '8-cleanup',
      title: 'Undo the favorites and notes this run created',
      meaning: 'The run leaves only the listed leftovers.',
      run: () => cleanup(ctx),
    },
  ];
}

export async function runChecks(
  gateway: Gateway,
  options: RunOptions,
  redact: (text: string) => string,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  let setupFailed = false;
  for (const spec of buildChecks(gateway, options)) {
    const started = performance.now();
    let outcome: Outcome;
    if (setupFailed && spec.id !== '1-anon-denied')
      outcome = skip('setup failed');
    else {
      try {
        outcome = await spec.run();
      } catch (error) {
        outcome = fail([
          `unexpected error: ${error instanceof Error ? error.message : 'unknown'}`,
        ]);
      }
    }
    if (spec.id === '0-setup' && outcome.status === 'FAIL') setupFailed = true;
    results.push({
      id: spec.id,
      title: spec.title,
      status: outcome.status,
      meaning: spec.meaning,
      observations: outcome.observations.map(redact),
      durationMs: Math.round(performance.now() - started),
    });
  }
  return results;
}
