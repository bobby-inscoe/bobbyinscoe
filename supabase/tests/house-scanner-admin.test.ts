import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { approvedPolicy } from '@house-scanner-tools/source-registry';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { z } from 'zod';
import {
  type Criteria,
  criteriaSchema,
  type IngestRequest,
  ingestRequestSchema,
  type Observation,
  observationSchema,
  type SourcePolicy,
  snapshotSchema,
  sourcePolicySchema,
} from '@/features/house-scanner/types/contracts';

// The administration functions are called as the database operator (the default
// role here, postgres in Supabase). Browser and service roles are used only to
// prove they cannot call them and to exercise what administration changes.
const OWNER = '20000000-0000-4000-8000-000000000001';
const MEMBER = '20000000-0000-4000-8000-000000000002';
const GUEST = '20000000-0000-4000-8000-000000000003';
const OUTSIDER = '20000000-0000-4000-8000-000000000004';
const OTHER_OWNER = '20000000-0000-4000-8000-000000000005';
const UNKNOWN_USER = '20000000-0000-4000-8000-0000000000ff';
const KEY = 'synthetic-key-a';
const ORIGIN = 'https://example.invalid';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HOUSEHOLD_NAME = 'Zq household';
const OWNER_NAME = 'Zq owner';
const MEMBER_NAME = 'Zq member';
const ADMIN_FUNCTIONS = [
  'admin_bootstrap_household',
  'admin_set_member',
  'admin_set_source_policy',
  'admin_issue_credential',
  'admin_revoke_credential',
];
const TABLES = [
  'households',
  'members',
  'profiles',
  'profile_versions',
  'source_policies',
  'ingest_credentials',
  'ingest_nonces',
  'runs',
  'batches',
  'staged_observations',
  'listings',
  'observations',
  'editions',
  'favorites',
  'notes',
  'hidden_listings',
  'admin_log',
] as const;
// Obviously fictional criteria. No real preference appears in the migration or here.
const criteria: Criteria = criteriaSchema.parse({
  minAreaM2: 50,
  maxAreaM2: null,
  minRooms: 2,
  preferredPriceSek: 2_000_000,
  stretchPriceSek: 3_000_000,
  propertyTypes: ['apartment', 'house'],
  excludeGroundFloor: false,
  requireLift: false,
  requireOutdoor: false,
  preferGlazing: false,
  feeReferenceSek: 4000,
  geography: { municipalities: ['Zq town'], center: [0, 0], radiusKm: 10 },
  nature: { preferImmediateGreenery: false, preferredWalkMinutes: 10 },
  transit: {
    preferredWalkMinutes: 10,
    preferredJourneyMinutes: 30,
    tradeoffJourneyMinutes: 60,
  },
});
const bootstrapSchema = z.strictObject({
  householdId: z.uuid(),
  profileId: z.uuid(),
});
const memberResultSchema = z.strictObject({
  created: z.boolean(),
  favoritesCleared: z.number().int(),
  notesCleared: z.number().int(),
});
const policyResultSchema = z.strictObject({
  sourceId: z.string(),
  created: z.boolean(),
  revision: z.number().int(),
});
const credentialResultSchema = z.strictObject({
  keyId: z.string(),
  sourceIds: z.array(z.string()),
  expiresAt: z.string(),
});
const revokeResultSchema = z.strictObject({
  keyId: z.string(),
  revokedAt: z.string(),
});
const logSchema = z.strictObject({
  id: z.coerce.number().int(),
  household_id: z.uuid(),
  action: z.string(),
  subject_user_id: z.uuid().nullable(),
  detail: z.record(z.string(), z.unknown()),
});
const ingestResultSchema = z.strictObject({
  runId: z.uuid(),
  state: z.enum(['staging', 'published', 'failed']),
  editionId: z.uuid().nullable().optional(),
});
const purgeSchema = z.strictObject({
  observationsDeleted: z.number().int(),
  stagedDeleted: z.number().int(),
  runsClosed: z.number().int(),
  listingsDeleted: z.number().int(),
  listingsScrubbed: z.number().int(),
  observationsScrubbed: z.number().int(),
  stagedScrubbed: z.number().int(),
  noncesDeleted: z.number().int(),
  cursorsReset: z.number().int(),
  more: z.boolean(),
});
const NO_WORK = {
  observationsDeleted: 0,
  stagedDeleted: 0,
  runsClosed: 0,
  listingsDeleted: 0,
  listingsScrubbed: 0,
  observationsScrubbed: 0,
  stagedScrubbed: 0,
  noncesDeleted: 0,
  cursorsReset: 0,
  more: false,
};
let db: PGlite;
let baseTime: number;

type Param = string | number | boolean | null;
type Role = 'anon' | 'authenticated' | 'service_role';

async function asRole<T>(
  role: Role,
  userId: string | null,
  action: () => Promise<T>,
) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    userId ?? '',
  ]);
  await db.exec(`set role ${role}`);
  try {
    return await action();
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

async function value(sql: string, params: Param[] = []) {
  const result = await db.query<{ value: unknown }>(sql, params);
  expect(result.rows).toHaveLength(1);
  return result.rows[0].value;
}

async function count(sql: string, params: Param[] = []) {
  const result = await db.query<{ count: number }>(sql, params);
  return result.rows[0].count;
}

function arrayLiteral(items: (string | null)[]) {
  return `{${items.map((item) => (item === null ? 'NULL' : JSON.stringify(item))).join(',')}}`;
}

function inDays(days: number) {
  return new Date(Date.now() + days * DAY).toISOString();
}

function aged(days: number) {
  return new Date(baseTime - days * DAY).toISOString();
}

function policy(
  sourceId = 'alpha',
  patch: Partial<SourcePolicy> = {},
): SourcePolicy {
  return sourcePolicySchema.parse({
    sourceId,
    revision: 1,
    status: 'approved',
    reviewedAt: new Date(baseTime - HOUR).toISOString(),
    reviewDueAt: new Date(baseTime + 30 * DAY).toISOString(),
    rightsBasis: 'Synthetic local test permission',
    listingOrigins: [ORIGIN],
    imageOrigins: [ORIGIN],
    allowedEvidenceSubjects: ['facts', 'nearby_nature'],
    freeOnly: true,
    automatedCollection: true,
    privateDisplay: true,
    imageDisplay: true,
    imageHotlink: true,
    modelProcessing: false,
    emailDigest: false,
    telegramDigest: false,
    allowedFactFields: [
      'propertyType',
      'tenure',
      'purchase',
      'livingAreaM2',
      'secondaryAreaM2',
      'rooms',
      'askingPriceSek',
      'groundFloor',
      'lift',
      'liftServesHome',
      'stepFree',
      'outdoor',
      'glazed',
      'largePrivateTerrace',
      'municipality',
      'baseFeeSek',
      'mandatoryMonthlySek',
      'status',
    ],
    retentionDays: 30,
    capabilities: {
      discovery: true,
      knownListingRefresh: true,
      unknownPrice: true,
      upcoming: true,
      pagination: true,
      resultCap: null,
      coverageGaps: [],
    },
    ...patch,
  });
}

function observation(sourceListingId: string, observedAt: string): Observation {
  return observationSchema.parse({
    sourceListingId,
    episodeId: 'synthetic-episode',
    sourceUrl: `${ORIGIN}/${sourceListingId}`,
    title: sourceListingId,
    observedAt,
    publishedAt: null,
    facts: {
      propertyType: 'apartment',
      tenure: 'cooperative',
      purchase: true,
      livingAreaM2: 60,
      secondaryAreaM2: null,
      rooms: 2,
      askingPriceSek: null,
      groundFloor: null,
      lift: null,
      liftServesHome: null,
      stepFree: null,
      outdoor: null,
      glazed: null,
      largePrivateTerrace: null,
      municipality: 'Zq town',
      baseFeeSek: null,
      mandatoryMonthlySek: null,
      status: 'available',
    },
    conflicts: [],
    coordinates: null,
    evidence: [],
    photo: null,
  });
}

// Operator calls. A null or undefined optional keeps the call valid so that a
// test can name the one argument it breaks.
async function bootstrap(
  args: {
    name?: string | null;
    owner?: string | null;
    ownerName?: string | null;
    profileName?: string | null;
    criteria?: unknown;
  } = {},
) {
  const {
    name = HOUSEHOLD_NAME,
    owner = OWNER,
    ownerName = OWNER_NAME,
    profileName = 'Synthetic profile',
    criteria: body = criteria,
  } = args;
  return bootstrapSchema.parse(
    await value(
      'select hs.admin_bootstrap_household($1,$2,$3,$4,$5::jsonb) as value',
      [
        name,
        owner,
        ownerName,
        profileName,
        body === null ? null : JSON.stringify(body),
      ],
    ),
  );
}

async function setMember(
  householdId: string | null,
  userId: string | null,
  options: {
    name?: string | null;
    role?: string | null;
    active?: boolean | null;
    clearFavorites?: boolean | null;
    clearNotes?: boolean | null;
  } = {},
) {
  const {
    name = MEMBER_NAME,
    role = 'member',
    active = true,
    clearFavorites,
    clearNotes,
  } = options;
  const params: Param[] = [householdId, userId, name, role, active];
  let sql = 'select hs.admin_set_member($1,$2,$3,$4,$5) as value';
  if (clearFavorites !== undefined || clearNotes !== undefined) {
    params.push(
      clearFavorites === undefined ? false : clearFavorites,
      clearNotes === undefined ? false : clearNotes,
    );
    sql = 'select hs.admin_set_member($1,$2,$3,$4,$5,$6,$7) as value';
  }
  return memberResultSchema.parse(await value(sql, params));
}

async function setPolicy(householdId: string | null, body: unknown) {
  return policyResultSchema.parse(
    await value('select hs.admin_set_source_policy($1,$2::jsonb) as value', [
      householdId,
      body === null ? null : JSON.stringify(body),
    ]),
  );
}

async function issue(
  householdId: string | null,
  keyId: string,
  sourceIds: (string | null)[] | null,
  expiresAt: string | null,
) {
  return credentialResultSchema.parse(
    await value(
      'select hs.admin_issue_credential($1,$2,$3::text[],$4::timestamptz) as value',
      [
        householdId,
        keyId,
        sourceIds === null ? null : arrayLiteral(sourceIds),
        expiresAt,
      ],
    ),
  );
}

async function revoke(keyId: string | null) {
  return revokeResultSchema.parse(
    await value('select hs.admin_revoke_credential($1) as value', [keyId]),
  );
}

async function logRows() {
  const result = await db.query(
    'select id,household_id,action,subject_user_id,detail from hs.admin_log order by id',
  );
  return result.rows.map((row) => logSchema.parse(row));
}

// A per-table md5 of every row, so that "nothing changed" is a comparison of all state.
async function digest(tables: readonly string[] = TABLES) {
  const result: Record<string, string> = {};
  for (const table of tables) {
    const row = await db.query<{ digest: string }>(
      `select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) digest from hs.${table} t`,
    );
    result[table] = row.rows[0].digest;
  }
  return result;
}

// Rows of a per-member table that belong to anyone except one user.
async function othersDigest(table: string, user: string) {
  const row = await db.query<{ digest: string }>(
    `select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) digest from hs.${table} t where user_id<>$1`,
    [user],
  );
  return row.rows[0].digest;
}

// A failed call changes no table, including the log.
async function expectNothingWritten(
  call: () => Promise<unknown>,
  message: string,
) {
  const before = await digest();
  await expect(call()).rejects.toThrow(message);
  expect(await digest()).toEqual(before);
}

// A successful call appends exactly one log row, returned for inspection.
async function expectOneLogRow<T>(call: () => Promise<T>, action: string) {
  const before = await logRows();
  const result = await call();
  const after = await logRows();
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const entry = after[after.length - 1];
  expect(entry.action).toBe(action);
  return { result, entry };
}

async function ingest(request: IngestRequest, key = KEY) {
  const body = JSON.stringify(ingestRequestSchema.parse(request));
  return asRole('service_role', null, async () =>
    ingestResultSchema.parse(
      await value('select public.hs_ingest($1,$2,$3::jsonb) as value', [
        key,
        createHash('sha256').update(body).digest('hex'),
        body,
      ]),
    ),
  );
}

async function publishListing(
  profileId: string,
  sourceListingId: string,
  observedAt: string,
  cursor = 'cursor-alpha',
) {
  const runId = randomUUID();
  await ingest({
    action: 'begin',
    contractVersion: 1,
    runId,
    sourceIds: ['alpha'],
    profileVersions: [{ profileId, revision: 1 }],
  });
  await ingest({
    action: 'stage',
    contractVersion: 1,
    runId,
    batchId: randomUUID(),
    sourceId: 'alpha',
    observations: [observation(sourceListingId, observedAt)],
  });
  return ingest({
    action: 'publish',
    contractVersion: 1,
    runId,
    results: [
      {
        sourceId: 'alpha',
        status: 'success',
        coverageNote: 'Synthetic local coverage',
        cursor,
      },
    ],
  });
}

async function snapshot(householdId: string, userId: string) {
  return asRole('authenticated', userId, async () =>
    snapshotSchema.parse(
      await value('select public.hs_snapshot($1) as value', [householdId]),
    ),
  );
}

async function favorite(
  householdId: string,
  listingId: string,
  userId: string,
  saved = true,
) {
  return asRole('authenticated', userId, () =>
    value('select public.hs_set_favorite($1,$2,$3) as value', [
      householdId,
      listingId,
      saved,
    ]),
  );
}

async function saveNote(
  householdId: string,
  listingId: string,
  userId: string,
  body: string,
) {
  return asRole('authenticated', userId, () =>
    value('select public.hs_save_note($1,$2,$3,0) as value', [
      householdId,
      listingId,
      body,
    ]),
  );
}

async function purge(householdId: string, dryRun: boolean) {
  return asRole('service_role', null, async () =>
    purgeSchema.parse(
      await value('select public.hs_purge_expired($1,100,$2) as value', [
        householdId,
        dryRun,
      ]),
    ),
  );
}

// Household with an owner, one member, an approved policy and an ingest credential.
async function seedHousehold() {
  const { householdId, profileId } = await bootstrap();
  await setMember(householdId, MEMBER);
  await setPolicy(householdId, policy());
  await issue(householdId, KEY, ['alpha'], inDays(30));
  return { householdId, profileId };
}

async function listingId(householdId: string, title: string) {
  const state = await snapshot(householdId, OWNER);
  const found = state.listings.find((item) => item.title === title)?.id;
  if (!found) throw new Error(`Listing ${title} missing`);
  return found;
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    -- Besides returning the caller, auth.uid() can count its own calls and, on the
    -- chosen call, run an operator change as if it had committed meanwhile. That
    -- places a membership change between a function's two membership checks, which
    -- a single PGlite connection cannot otherwise do. Idle unless counting is true.
    create table public.test_hook(
      counting boolean not null default false, calls integer not null default 0,
      fire_at integer, household uuid, victim uuid, demote_only boolean not null default false);
    insert into public.test_hook default values;
    create function auth.uid() returns uuid language plpgsql security definer as $$
    declare h public.test_hook;
    begin
      select * into h from public.test_hook;
      if h.counting then
        update public.test_hook set calls=calls+1;
        if h.calls+1=h.fire_at then
          if h.demote_only then
            perform hs.admin_set_member(h.household,h.victim,'Departed','member',true);
          else
            perform hs.admin_set_member(h.household,h.victim,'Departed','member',false,true,true);
          end if;
        end if;
      end if;
      return nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    end $$;
  `);
  for (const migration of [
    '202610120001_house_scanner.sql',
    '202610120002_house_scanner_retention.sql',
    '202610120003_house_scanner_admin.sql',
    '202610170001_house_scanner_hidden.sql',
    '202610170002_house_scanner_snapshot_notes.sql',
    '202610180001_house_scanner_viewings.sql',
    '202610180002_house_scanner_snapshot_limit.sql',
  ])
    await db.exec(
      await readFile(
        new URL(`../migrations/${migration}`, import.meta.url),
        'utf8',
      ),
    );
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.reject(
        new Error('Network is disabled in database behavior tests'),
      ),
    ),
  );
  baseTime = Date.now() - 4 * HOUR;
  await db.exec('truncate hs.households, hs.admin_log, auth.users cascade');
  for (const id of [OWNER, MEMBER, GUEST, OUTSIDER, OTHER_OWNER])
    await db.query('insert into auth.users values($1)', [id]);
});

describe('operator-only access', () => {
  it('keeps every administration function and the log out of reach of API roles', async () => {
    const log = await db.query<{
      relrowsecurity: boolean;
      policies: number;
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(`
      select c.relrowsecurity,
        (select count(*)::int from pg_policies where schemaname='hs' and tablename='admin_log') policies,
        has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') anon,
        has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') authenticated,
        has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') service
      from pg_class c where c.oid='hs.admin_log'::regclass
    `);
    expect(log.rows[0]).toEqual({
      relrowsecurity: true,
      policies: 0,
      anon: false,
      authenticated: false,
      service: false,
    });
    const functions = await db.query<{
      proname: string;
      invoker: boolean;
      anon: boolean;
      authenticated: boolean;
      service: boolean;
      operator: boolean;
      other_grantees: number;
    }>(`
      select p.proname,not p.prosecdef invoker,
        has_function_privilege('anon',p.oid,'EXECUTE') anon,
        has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
        has_function_privilege('service_role',p.oid,'EXECUTE') service,
        has_function_privilege(current_user,p.oid,'EXECUTE') operator,
        (select count(*)::int from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee<>p.proowner) other_grantees
      from pg_proc p where p.pronamespace='hs'::regnamespace and (p.proname like 'admin\\_%' or p.proname='valid_policy')
      order by p.proname
    `);
    expect(functions.rows.map((row) => row.proname)).toEqual(
      [...ADMIN_FUNCTIONS, 'valid_policy'].sort(),
    );
    for (const row of functions.rows)
      expect(row).toMatchObject({
        invoker: true,
        anon: false,
        authenticated: false,
        service: false,
        operator: true,
        other_grantees: 0,
      });
    // No browser, PostgREST or Edge entry point was added to the public schema.
    const exposed = await db.query<{ proname: string }>(
      "select proname from pg_proc where pronamespace='public'::regnamespace order by proname",
    );
    expect(exposed.rows).toHaveLength(13);
    for (const row of exposed.rows) expect(row.proname).toMatch(/^hs_/);
    expect(exposed.rows.map((row) => row.proname)).not.toContainEqual(
      expect.stringContaining('admin'),
    );
  });

  it('refuses direct calls and log reads from anon, authenticated and service roles', async () => {
    const { householdId } = await seedHousehold();
    await revoke(KEY);
    await issue(householdId, 'second-key', ['alpha'], inDays(5));
    const before = await digest();
    const calls: [string, Param[]][] = [
      [
        "select hs.admin_bootstrap_household('x',$1,'x','x','{}'::jsonb)",
        [OTHER_OWNER],
      ],
      [
        "select hs.admin_set_member($1,$2,'x','member',true)",
        [householdId, MEMBER],
      ],
      ["select hs.admin_set_source_policy($1,'{}'::jsonb)", [householdId]],
      [
        "select hs.admin_issue_credential($1,'third-key',array['alpha'],now()+interval '1 day')",
        [householdId],
      ],
      ["select hs.admin_revoke_credential('second-key')", []],
      ['select hs.valid_policy(null)', []],
      ['select * from hs.admin_log', []],
    ];
    for (const [role, user] of [
      ['anon', null],
      ['authenticated', OWNER],
      ['service_role', null],
    ] as const)
      for (const [sql, params] of calls)
        await expect(
          asRole(role, user, () => db.query(sql, params)),
        ).rejects.toMatchObject({ code: '42501' });
    expect(await digest()).toEqual(before);
  });

  it('has no default for criteria and writes none of its own', async () => {
    const defaults = await db.query<{ pronargdefaults: number }>(
      "select pronargdefaults from pg_proc where proname='admin_bootstrap_household' and pronamespace='hs'::regnamespace",
    );
    expect(defaults.rows).toEqual([{ pronargdefaults: 0 }]);
    await expect(
      db.query("select hs.admin_bootstrap_household('x',$1,'x','x') as value", [
        OWNER,
      ]),
    ).rejects.toThrow('does not exist');
    const source = await readFile(
      new URL(
        '../migrations/202610120003_house_scanner_admin.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(source).not.toMatch(/minAreaM2|preferredPriceSek|municipalities/);
  });
});

describe('hs.admin_bootstrap_household', () => {
  it('creates exactly one household, one active owner and one enabled profile at revision 1', async () => {
    const empty = await digest();
    const { result, entry } = await expectOneLogRow(
      () => bootstrap(),
      'bootstrap_household',
    );
    const after = await digest();
    const changed = TABLES.filter((table) => empty[table] !== after[table]);
    expect(changed).toEqual(['households', 'members', 'profiles', 'admin_log']);
    for (const [table, expected] of [
      ['households', 1],
      ['members', 1],
      ['profiles', 1],
    ] as const)
      expect(await count(`select count(*)::int count from hs.${table}`)).toBe(
        expected,
      );
    const household = await db.query('select id,name from hs.households');
    expect(household.rows).toEqual([
      { id: result.householdId, name: HOUSEHOLD_NAME },
    ]);
    const member = await db.query(
      'select household_id,user_id,display_name,role,active from hs.members',
    );
    expect(member.rows).toEqual([
      {
        household_id: result.householdId,
        user_id: OWNER,
        display_name: OWNER_NAME,
        role: 'owner',
        active: true,
      },
    ]);
    const profile = await db.query(
      'select id,household_id,revision,name,enabled,criteria,edited_by from hs.profiles',
    );
    expect(profile.rows).toEqual([
      {
        id: result.profileId,
        household_id: result.householdId,
        revision: 1,
        name: 'Synthetic profile',
        enabled: true,
        criteria,
        edited_by: OWNER,
      },
    ]);
    expect(entry).toMatchObject({
      household_id: result.householdId,
      subject_user_id: OWNER,
      detail: { profileId: result.profileId, profileRevision: 1 },
    });
  });

  it('gives the owner a readable household with the profile and no listings', async () => {
    const { householdId, profileId } = await bootstrap();
    const state = await snapshot(householdId, OWNER);
    expect(state.members).toEqual([
      {
        householdId,
        userId: OWNER,
        displayName: OWNER_NAME,
        role: 'owner',
      },
    ]);
    expect(state.profiles.map((item) => item.id)).toEqual([profileId]);
    expect(state.profiles[0]).toMatchObject({ revision: 1, enabled: true });
    expect(state.listings).toEqual([]);
    await expect(snapshot(householdId, OUTSIDER)).rejects.toThrow(
      'Household access denied',
    );
  });

  it('trims names and accepts an 80 character name', async () => {
    const long = 'x'.repeat(80);
    const { householdId } = await bootstrap({
      name: `  ${long}  `,
      ownerName: ' Zq owner ',
      profileName: ` ${long}`,
    });
    const row = await db.query(
      'select h.name household,m.display_name owner,p.name profile from hs.households h join hs.members m on m.household_id=h.id join hs.profiles p on p.household_id=h.id where h.id=$1',
      [householdId],
    );
    expect(row.rows).toEqual([
      { household: long, owner: 'Zq owner', profile: long },
    ]);
  });

  const broken = (
    key: keyof typeof criteria | 'extra',
    patch: unknown,
  ): Record<string, unknown> => ({ ...criteria, [key]: patch });
  const withoutKey = Object.fromEntries(
    Object.entries(criteria).filter(([key]) => key !== 'minRooms'),
  );
  it.each<[string, Parameters<typeof bootstrap>[0], string]>([
    ['an empty household name', { name: '' }, 'Invalid household'],
    ['a blank household name', { name: ' \t ' }, 'Invalid household'],
    ['a null household name', { name: null }, 'Invalid household'],
    [
      'a household name over 80 characters',
      { name: 'x'.repeat(81) },
      'Invalid household',
    ],
    ['an empty owner name', { ownerName: '' }, 'Invalid household'],
    ['a null owner name', { ownerName: null }, 'Invalid household'],
    ['an empty profile name', { profileName: '  ' }, 'Invalid household'],
    ['a null profile name', { profileName: null }, 'Invalid household'],
    ['a null owner', { owner: null }, 'Invalid household'],
    ['an unknown auth user', { owner: UNKNOWN_USER }, 'Unknown auth user'],
    ['null criteria', { criteria: null }, 'Invalid household'],
    ['empty criteria', { criteria: {} }, 'Invalid household'],
    ['criteria missing a key', { criteria: withoutKey }, 'Invalid household'],
    [
      'criteria with an extra key',
      { criteria: broken('extra', 1) },
      'Invalid household',
    ],
    [
      'criteria with a string number',
      { criteria: broken('minRooms', '2') },
      'Invalid household',
    ],
    [
      'criteria with a maximum area below the minimum',
      { criteria: broken('maxAreaM2', 10) },
      'Invalid household',
    ],
    [
      'criteria with a stretch price below the preferred price',
      { criteria: broken('stretchPriceSek', 1) },
      'Invalid household',
    ],
    [
      'criteria with an unknown property type',
      { criteria: broken('propertyTypes', ['castle']) },
      'Invalid household',
    ],
  ])('rejects %s and writes nothing', async (_name, args, message) => {
    await expectNothingWritten(() => bootstrap(args), message);
    expect(await count('select count(*)::int count from hs.households')).toBe(
      0,
    );
  });

  it('never replaces or touches an earlier household', async () => {
    const first = await bootstrap();
    const state = await digest();
    const second = await bootstrap({ owner: OTHER_OWNER, name: 'Second' });
    expect(second.householdId).not.toBe(first.householdId);
    expect(await count('select count(*)::int count from hs.households')).toBe(
      2,
    );
    expect(await count('select count(*)::int count from hs.admin_log')).toBe(2);
    expect(state.members).not.toBe((await digest()).members);
    expect(
      await count(
        'select count(*)::int count from hs.members where household_id=$1',
        [first.householdId],
      ),
    ).toBe(1);
  });
});

describe('hs.admin_set_member', () => {
  it('adds a member, updates role and name, and logs each change without the display name', async () => {
    const { householdId } = await bootstrap();
    const added = await expectOneLogRow(
      () => setMember(householdId, MEMBER),
      'set_member',
    );
    expect(added.result).toEqual({
      created: true,
      favoritesCleared: 0,
      notesCleared: 0,
    });
    expect(added.entry).toMatchObject({
      household_id: householdId,
      subject_user_id: MEMBER,
      detail: {
        created: true,
        role: { old: null, new: 'member' },
        active: { old: null, new: true },
        displayNameChanged: true,
      },
    });
    const updated = await expectOneLogRow(
      () => setMember(householdId, MEMBER, { name: 'Renamed', role: 'owner' }),
      'set_member',
    );
    expect(updated.result.created).toBe(false);
    expect(updated.entry.detail).toMatchObject({
      created: false,
      role: { old: 'member', new: 'owner' },
      active: { old: true, new: true },
      displayNameChanged: true,
    });
    const stored = await db.query(
      'select display_name,role,active from hs.members where user_id=$1',
      [MEMBER],
    );
    expect(stored.rows).toEqual([
      { display_name: 'Renamed', role: 'owner', active: true },
    ]);
    expect(JSON.stringify(await logRows())).not.toContain('Renamed');
    expect(JSON.stringify(await logRows())).not.toContain('Zq');
  });

  it.each<[string, Parameters<typeof setMember>[2], string]>([
    ['an empty name', { name: '' }, 'Invalid member'],
    ['a blank name', { name: ' ' }, 'Invalid member'],
    ['a null name', { name: null }, 'Invalid member'],
    ['a name over 80 characters', { name: 'x'.repeat(81) }, 'Invalid member'],
    ['an unknown role', { role: 'admin' }, 'Invalid member'],
    ['a null role', { role: null }, 'Invalid member'],
    ['a null active flag', { active: null }, 'Invalid member'],
    ['a null clear favorites flag', { clearFavorites: null }, 'Invalid member'],
    ['a null clear notes flag', { clearNotes: null }, 'Invalid member'],
    [
      'clear flags on an active member',
      { active: true, clearFavorites: true },
      'Clearing needs an inactive member',
    ],
    [
      'clear notes on an active member',
      { active: true, clearNotes: true },
      'Clearing needs an inactive member',
    ],
  ])('rejects %s and writes nothing', async (_name, options, message) => {
    const { householdId } = await bootstrap();
    await expectNothingWritten(
      () => setMember(householdId, MEMBER, options),
      message,
    );
  });

  it('rejects an unknown auth user and an unknown household and writes nothing', async () => {
    const { householdId } = await bootstrap();
    await expectNothingWritten(
      () => setMember(householdId, UNKNOWN_USER),
      'Unknown auth user',
    );
    await expectNothingWritten(
      () => setMember(randomUUID(), MEMBER),
      'Household unavailable',
    );
    await expectNothingWritten(
      () => setMember(householdId, null),
      'Invalid member',
    );
  });

  it('never loses the last active owner', async () => {
    const { householdId } = await bootstrap();
    await setMember(householdId, MEMBER);
    await expectNothingWritten(
      () => setMember(householdId, OWNER, { role: 'member' }),
      'Household needs an active owner',
    );
    await expectNothingWritten(
      () => setMember(householdId, OWNER, { role: 'owner', active: false }),
      'Household needs an active owner',
    );
    // An inactive owner does not count as a second owner.
    await setMember(householdId, MEMBER, { role: 'owner' });
    await setMember(householdId, MEMBER, { role: 'owner', active: false });
    await expectNothingWritten(
      () => setMember(householdId, OWNER, { role: 'member' }),
      'Household needs an active owner',
    );
    // With a second active owner the first can step down.
    await setMember(householdId, MEMBER, { role: 'owner', active: true });
    await setMember(householdId, OWNER, { role: 'member' });
    await expectNothingWritten(
      () => setMember(householdId, MEMBER, { role: 'owner', active: false }),
      'Household needs an active owner',
    );
    expect(
      await count(
        "select count(*)::int count from hs.members where household_id=$1 and role='owner' and active",
        [householdId],
      ),
    ).toBe(1);
  });

  it('allows ten member rows, counts inactive rows, and rejects an eleventh', async () => {
    const { householdId } = await bootstrap();
    const extra: string[] = [MEMBER, GUEST, OUTSIDER, OTHER_OWNER];
    for (let index = 0; index < 8; index++) {
      const id = `40000000-0000-4000-8000-00000000000${index}`;
      await db.query('insert into auth.users values($1)', [id]);
      extra.push(id);
    }
    for (const id of extra.slice(0, 9)) await setMember(householdId, id);
    expect(
      await count(
        'select count(*)::int count from hs.members where household_id=$1',
        [householdId],
      ),
    ).toBe(10);
    expect((await snapshot(householdId, OWNER)).members).toHaveLength(10);
    await expectNothingWritten(
      () => setMember(householdId, extra[9]),
      'Household member limit reached',
    );
    // Existing rows stay editable at the limit, and a deactivated row still counts.
    await setMember(householdId, MEMBER, { name: 'Renamed', active: false });
    await expectNothingWritten(
      () => setMember(householdId, extra[9]),
      'Household member limit reached',
    );
    expect((await snapshot(householdId, OWNER)).members).toHaveLength(10);
  });

  describe('leaving members', () => {
    // MEMBER saves two listings and writes two notes, one of them blank; GUEST and
    // OWNER also save and write, so any over-deletion shows up in their rows.
    async function seedShared() {
      const seeded = await seedHousehold();
      await setMember(seeded.householdId, GUEST);
      await publishListing(seeded.profileId, 'home-one', aged(0));
      await publishListing(seeded.profileId, 'home-two', aged(0), 'cursor-2');
      const one = await listingId(seeded.householdId, 'home-one');
      const two = await listingId(seeded.householdId, 'home-two');
      for (const [listing, user] of [
        [one, MEMBER],
        [two, MEMBER],
        [one, GUEST],
        [one, OWNER],
      ] as const)
        await favorite(seeded.householdId, listing, user);
      await saveNote(seeded.householdId, one, MEMBER, 'note by member');
      await saveNote(seeded.householdId, two, MEMBER, '');
      await saveNote(seeded.householdId, two, GUEST, 'note by guest');
      await saveNote(seeded.householdId, one, OWNER, 'note by owner');
      return { ...seeded, one, two };
    }

    it('keeps favorites, notes and member attribution when a member is deactivated', async () => {
      const { householdId, one } = await seedShared();
      const before = await digest(['favorites', 'notes', 'listings']);
      const members = await othersDigest('members', MEMBER);
      const { result, entry } = await expectOneLogRow(
        () => setMember(householdId, MEMBER, { active: false }),
        'set_member',
      );
      expect(result).toEqual({
        created: false,
        favoritesCleared: 0,
        notesCleared: 0,
      });
      expect(entry.detail).toMatchObject({
        active: { old: true, new: false },
        clearFavorites: false,
        clearNotes: false,
        favoritesCleared: 0,
        notesCleared: 0,
      });
      expect(await digest(['favorites', 'notes', 'listings'])).toEqual(before);
      expect(await othersDigest('members', MEMBER)).toBe(members);
      expect(
        await count(
          'select count(*)::int count from hs.members where user_id=$1 and not active',
          [MEMBER],
        ),
      ).toBe(1);
      const state = await snapshot(householdId, OWNER);
      expect(state.members.map((item) => item.userId)).toContain(MEMBER);
      expect(
        state.favorites.filter((item) => item.userId === MEMBER),
      ).toHaveLength(2);
      expect(
        state.favorites.filter((item) => item.listingId === one),
      ).toHaveLength(3);
      // The departed member can no longer read or write.
      await expect(snapshot(householdId, MEMBER)).rejects.toThrow(
        'Household access denied',
      );
      await expect(favorite(householdId, one, MEMBER, false)).rejects.toThrow(
        'Household access denied',
      );
    });

    it('restores nothing and deletes nothing on reactivation', async () => {
      const { householdId } = await seedShared();
      await setMember(householdId, MEMBER, { active: false });
      const before = await digest(['favorites', 'notes', 'listings']);
      await setMember(householdId, MEMBER, { active: true });
      expect(await digest(['favorites', 'notes', 'listings'])).toEqual(before);
      expect(
        (await snapshot(householdId, MEMBER)).favorites.filter(
          (item) => item.userId === MEMBER,
        ),
      ).toHaveLength(2);
    });

    it('clears only that member favorites when asked, and no one else rows', async () => {
      const { householdId } = await seedShared();
      const others = {
        favorites: await othersDigest('favorites', MEMBER),
        notes: await othersDigest('notes', MEMBER),
        members: await othersDigest('members', MEMBER),
      };
      const notes = await db.query(
        'select * from hs.notes where user_id=$1 order by listing_id',
        [MEMBER],
      );
      const { result, entry } = await expectOneLogRow(
        () =>
          setMember(householdId, MEMBER, {
            active: false,
            clearFavorites: true,
          }),
        'set_member',
      );
      expect(result).toEqual({
        created: false,
        favoritesCleared: 2,
        notesCleared: 0,
      });
      expect(entry.detail).toMatchObject({
        clearFavorites: true,
        favoritesCleared: 2,
        clearNotes: false,
        notesCleared: 0,
      });
      expect(
        await count(
          'select count(*)::int count from hs.favorites where user_id=$1',
          [MEMBER],
        ),
      ).toBe(0);
      const after = await db.query(
        'select * from hs.notes where user_id=$1 order by listing_id',
        [MEMBER],
      );
      expect(after.rows).toEqual(notes.rows);
      expect(await othersDigest('favorites', MEMBER)).toBe(others.favorites);
      expect(await othersDigest('notes', MEMBER)).toBe(others.notes);
      expect(await othersDigest('members', MEMBER)).toBe(others.members);
    });

    it('clears only that member notes, blank rows included, when asked', async () => {
      const { householdId } = await seedShared();
      const others = {
        favorites: await othersDigest('favorites', MEMBER),
        notes: await othersDigest('notes', MEMBER),
      };
      const favorites = await db.query(
        'select * from hs.favorites where user_id=$1 order by listing_id',
        [MEMBER],
      );
      const { result, entry } = await expectOneLogRow(
        () =>
          setMember(householdId, MEMBER, { active: false, clearNotes: true }),
        'set_member',
      );
      expect(result).toEqual({
        created: false,
        favoritesCleared: 0,
        notesCleared: 2,
      });
      expect(entry.detail).toMatchObject({
        clearNotes: true,
        notesCleared: 2,
        clearFavorites: false,
      });
      expect(
        await count(
          'select count(*)::int count from hs.notes where user_id=$1',
          [MEMBER],
        ),
      ).toBe(0);
      const after = await db.query(
        'select * from hs.favorites where user_id=$1 order by listing_id',
        [MEMBER],
      );
      expect(after.rows).toEqual(favorites.rows);
      expect(await othersDigest('favorites', MEMBER)).toBe(others.favorites);
      expect(await othersDigest('notes', MEMBER)).toBe(others.notes);
    });

    it('clears both on a member who is already inactive, as a separate later step', async () => {
      const { householdId } = await seedShared();
      await setMember(householdId, MEMBER, { active: false });
      const others = [
        await othersDigest('favorites', MEMBER),
        await othersDigest('notes', MEMBER),
      ];
      const { result } = await expectOneLogRow(
        () =>
          setMember(householdId, MEMBER, {
            active: false,
            clearFavorites: true,
            clearNotes: true,
          }),
        'set_member',
      );
      expect(result).toEqual({
        created: false,
        favoritesCleared: 2,
        notesCleared: 2,
      });
      expect([
        await othersDigest('favorites', MEMBER),
        await othersDigest('notes', MEMBER),
      ]).toEqual(others);
      expect(
        await count(
          'select count(*)::int count from hs.members where user_id=$1',
          [MEMBER],
        ),
      ).toBe(1);
    });

    it('defaults both clear flags to false', async () => {
      const { householdId } = await seedShared();
      const before = await digest(['favorites', 'notes']);
      await setMember(householdId, MEMBER, { active: false });
      expect(await digest(['favorites', 'notes'])).toEqual(before);
      const defaults = await db.query<{ args: string }>(
        "select pg_get_function_arguments(p.oid) args from pg_proc p where proname='admin_set_member' and pronamespace='hs'::regnamespace",
      );
      expect(defaults.rows[0].args).toContain(
        'p_clear_favorites boolean DEFAULT false',
      );
      expect(defaults.rows[0].args).toContain(
        'p_clear_notes boolean DEFAULT false',
      );
    });

    it('leaves a listing only a deactivated member saved visible and unpurged until the explicit clear', async () => {
      const { householdId, profileId } = await seedHousehold();
      await publishListing(profileId, 'home', aged(2));
      const id = await listingId(householdId, 'home');
      await favorite(householdId, id, MEMBER);
      await setMember(householdId, MEMBER, { active: false });
      // The policy lapses into a one day retention, so the listing is expired.
      await setPolicy(
        householdId,
        policy('alpha', { revision: 2, retentionDays: 1 }),
      );
      const dry = await purge(householdId, true);
      expect(dry).toEqual({ ...NO_WORK, stagedDeleted: 1 });
      expect(await purge(householdId, false)).toEqual(dry);
      let state = await snapshot(householdId, OWNER);
      expect(state.listings.map((item) => item.id)).toEqual([id]);
      expect(state.listings[0]).toMatchObject({ title: 'home' });
      expect(state.favorites).toEqual([
        expect.objectContaining({ listingId: id, userId: MEMBER }),
      ]);
      expect(
        await count('select count(*)::int count from hs.observations'),
      ).toBe(1);

      await setMember(householdId, MEMBER, {
        active: false,
        clearFavorites: true,
      });
      expect(await purge(householdId, true)).toEqual({
        ...NO_WORK,
        observationsDeleted: 1,
        listingsDeleted: 1,
      });
      // The dry run changed nothing, and the snapshot already hides the expired listing.
      expect(await count('select count(*)::int count from hs.listings')).toBe(
        1,
      );
      state = await snapshot(householdId, OWNER);
      expect(state.listings).toEqual([]);
      expect(await purge(householdId, false)).toEqual({
        ...NO_WORK,
        observationsDeleted: 1,
        listingsDeleted: 1,
      });
      expect(await count('select count(*)::int count from hs.listings')).toBe(
        0,
      );
      expect(await count('select count(*)::int count from hs.members')).toBe(2);
    });

    it('does the same for a listing only a deactivated member wrote a note on', async () => {
      const { householdId, profileId } = await seedHousehold();
      await publishListing(profileId, 'home', aged(2));
      const id = await listingId(householdId, 'home');
      await saveNote(householdId, id, MEMBER, 'keep this');
      await setMember(householdId, MEMBER, { active: false });
      await setPolicy(
        householdId,
        policy('alpha', { revision: 2, retentionDays: 1 }),
      );
      expect((await purge(householdId, true)).listingsDeleted).toBe(0);
      await setMember(householdId, MEMBER, { active: false, clearNotes: true });
      expect((await purge(householdId, true)).listingsDeleted).toBe(1);
    });
  });
});

describe('hs.valid_policy and hs.admin_set_source_policy', () => {
  const REMOVE = Symbol('remove');

  function setPath(source: unknown, path: string[], next: unknown): unknown {
    const [key, ...rest] = path;
    const object = { ...(source as Record<string, unknown>) };
    if (rest.length > 0)
      return { ...object, [key]: setPath(object[key], rest, next) };
    if (next === REMOVE)
      return Object.fromEntries(
        Object.entries(object).filter(([name]) => name !== key),
      );
    return { ...object, [key]: next };
  }

  async function dbAccepts(body: unknown) {
    return (await value('select hs.valid_policy($1::jsonb) as value', [
      JSON.stringify(body),
    ])) as boolean;
  }

  // The Edge function parses the JSON a database returns, and a URL refinement in
  // the schema can throw rather than fail, which still means rejected.
  function schemaAccepts(body: unknown) {
    try {
      return sourcePolicySchema.safeParse(JSON.parse(JSON.stringify(body)))
        .success;
    } catch {
      return false;
    }
  }

  it('covers every key of the schema, so a new key forces a validator update', () => {
    // Twenty required keys and the optional viewings flag.
    expect(Object.keys(sourcePolicySchema.shape)).toHaveLength(21);
    expect(
      Object.keys(sourcePolicySchema.shape.capabilities.shape),
    ).toHaveLength(7);
  });

  it('accepts the optional viewings flag as a boolean or left out, and refuses anything else, as the schema does', async () => {
    for (const viewings of [true, false, undefined]) {
      const candidate = { ...policy(), viewings };
      expect(await dbAccepts(candidate)).toBe(true);
      expect(schemaAccepts(candidate)).toBe(true);
    }
    for (const viewings of ['yes', 1, null, [], {}]) {
      const candidate = { ...policy(), viewings };
      expect(await dbAccepts(candidate)).toBe(false);
      expect(schemaAccepts(candidate)).toBe(false);
    }
    expect(await dbAccepts({ ...policy(), viewings: true, extra: 1 })).toBe(
      false,
    );
  });

  it('accepts the fixture and every status', async () => {
    expect(await dbAccepts(policy())).toBe(true);
    for (const status of ['disabled', 'pending', 'approved'] as const)
      expect(await dbAccepts(policy('alpha', { status }))).toBe(true);
  });

  it('agrees with the schema on every key replaced by a wrong type or removed', async () => {
    const base = policy();
    const paths = [
      ...Object.keys(base).map((key) => [key]),
      ...Object.keys(base.capabilities).map((key) => ['capabilities', key]),
      ['extra'],
      ['capabilities', 'extra'],
    ];
    const replacements: unknown[] = [
      REMOVE,
      null,
      'text',
      '',
      42,
      0,
      -1,
      1.5,
      true,
      false,
      {},
      [],
      ['text'],
      [1],
    ];
    const mismatches: string[] = [];
    let accepted = 0;
    let rejected = 0;
    for (const path of paths)
      for (const replacement of replacements) {
        const body = setPath(base, path, replacement);
        const expected = schemaAccepts(body);
        if (expected) accepted++;
        else rejected++;
        if ((await dbAccepts(body)) !== expected)
          mismatches.push(
            `${path.join('.')} = ${replacement === REMOVE ? 'removed' : JSON.stringify(replacement)}: schema ${expected}`,
          );
      }
    expect(mismatches).toEqual([]);
    expect(accepted).toBeGreaterThan(20);
    expect(rejected).toBeGreaterThan(300);
  });

  const text = (length: number) => 'x'.repeat(length);
  const subjects = [
    'facts',
    'nearby_nature',
    'nature_access',
    'green_outlook',
    'privacy',
    'quietness',
    'transit',
  ];
  const origins = (length: number) =>
    Array.from(
      { length },
      (_, index) => `https://host-${index}.example.invalid`,
    );
  const boundaries: [string, string[], unknown][] = [
    ['sourceId lower bound', ['sourceId'], 'a'],
    ['sourceId at 60', ['sourceId'], text(60)],
    ['sourceId at 61', ['sourceId'], text(61)],
    ['sourceId uppercase', ['sourceId'], 'Alpha'],
    ['sourceId underscore', ['sourceId'], 'a_b'],
    ['sourceId trailing newline', ['sourceId'], 'alpha\n'],
    ['revision 1', ['revision'], 1],
    ['revision 0', ['revision'], 0],
    ['revision fractional', ['revision'], 2.5],
    ['revision numeric string', ['revision'], '1'],
    ['revision at int maximum', ['revision'], 2_147_483_647],
    ['status unknown', ['status'], 'archived'],
    ['status uppercase', ['status'], 'APPROVED'],
    ['retention 1', ['retentionDays'], 1],
    ['retention 180', ['retentionDays'], 180],
    ['retention 0', ['retentionDays'], 0],
    ['retention 181', ['retentionDays'], 181],
    ['retention fractional', ['retentionDays'], 30.5],
    ['retention string', ['retentionDays'], '30'],
    ['freeOnly false', ['freeOnly'], false],
    ['rightsBasis 2000', ['rightsBasis'], text(2000)],
    ['rightsBasis 2001', ['rightsBasis'], text(2001)],
    ['rightsBasis empty', ['rightsBasis'], ''],
    ['listing origins empty', ['listingOrigins'], []],
    ['listing origins 20', ['listingOrigins'], origins(20)],
    ['listing origins 21', ['listingOrigins'], origins(21)],
    ['image origins empty', ['imageOrigins'], []],
    ['image origins 20', ['imageOrigins'], origins(20)],
    ['image origins 21', ['imageOrigins'], origins(21)],
    ['origin with trailing slash', ['listingOrigins'], [`${ORIGIN}/`]],
    ['origin with path', ['listingOrigins'], [`${ORIGIN}/search`]],
    [
      'origin with uppercase host',
      ['listingOrigins'],
      ['https://Example.invalid'],
    ],
    ['origin with default https port', ['listingOrigins'], [`${ORIGIN}:443`]],
    [
      'origin with default http port',
      ['listingOrigins'],
      ['http://example.invalid:80'],
    ],
    ['origin with other port', ['listingOrigins'], [`${ORIGIN}:8443`]],
    ['origin with port 65535', ['listingOrigins'], [`${ORIGIN}:65535`]],
    ['origin with port 65536', ['listingOrigins'], [`${ORIGIN}:65536`]],
    ['origin with leading zero port', ['listingOrigins'], [`${ORIGIN}:080`]],
    ['origin with port 0', ['listingOrigins'], [`${ORIGIN}:0`]],
    [
      'origin with userinfo',
      ['listingOrigins'],
      ['https://user@example.invalid'],
    ],
    ['origin with whitespace', ['listingOrigins'], ['https://a b.example']],
    [
      'origin that is a mailto link',
      ['listingOrigins'],
      ['mailto:a@example.invalid'],
    ],
    ['origin that is empty', ['listingOrigins'], ['']],
    ['origin that is a number', ['listingOrigins'], [1]],
    [
      'origin with a non ASCII host',
      ['listingOrigins'],
      ['https://bücher.example'],
    ],
    [
      'origin with a dotted quad host',
      ['listingOrigins'],
      ['https://127.0.0.1'],
    ],
    ['origin with a short dotted host', ['listingOrigins'], ['https://1.2.3']],
    [
      'origin with an out of range dotted host',
      ['listingOrigins'],
      ['https://999.1.1.1'],
    ],
    ['origin localhost', ['listingOrigins'], ['http://localhost']],
    [
      'origin with a bad image origin',
      ['imageOrigins'],
      [`${ORIGIN}/photo.jpg`],
    ],
    ['fact fields empty', ['allowedFactFields'], []],
    ['fact fields 20 repeats', ['allowedFactFields'], Array(20).fill('rooms')],
    ['fact fields 21 repeats', ['allowedFactFields'], Array(21).fill('rooms')],
    ['fact field unknown', ['allowedFactFields'], ['colour']],
    ['fact field wrong case', ['allowedFactFields'], ['Rooms']],
    ['evidence subjects empty', ['allowedEvidenceSubjects'], []],
    ['evidence subjects all', ['allowedEvidenceSubjects'], subjects],
    [
      'evidence subjects 10',
      ['allowedEvidenceSubjects'],
      Array(10).fill('facts'),
    ],
    [
      'evidence subjects 11',
      ['allowedEvidenceSubjects'],
      Array(11).fill('facts'),
    ],
    ['evidence subject unknown', ['allowedEvidenceSubjects'], ['gossip']],
    ['result cap 1', ['capabilities', 'resultCap'], 1],
    ['result cap 0', ['capabilities', 'resultCap'], 0],
    ['result cap negative', ['capabilities', 'resultCap'], -5],
    ['result cap fractional', ['capabilities', 'resultCap'], 2.5],
    ['result cap string', ['capabilities', 'resultCap'], '10'],
    [
      'coverage gaps 30',
      ['capabilities', 'coverageGaps'],
      Array(30).fill('gap'),
    ],
    [
      'coverage gaps 31',
      ['capabilities', 'coverageGaps'],
      Array(31).fill('gap'),
    ],
    ['coverage gap 300', ['capabilities', 'coverageGaps'], [text(300)]],
    ['coverage gap 301', ['capabilities', 'coverageGaps'], [text(301)]],
    [
      'coverage gap 150 astral characters',
      ['capabilities', 'coverageGaps'],
      ['\u{1F600}'.repeat(150)],
    ],
    ['coverage gap number', ['capabilities', 'coverageGaps'], [1]],
  ];

  it.each(boundaries)(
    'agrees with the schema on %s',
    async (_name, path, replacement) => {
      const body = setPath(policy(), path, replacement);
      expect(await dbAccepts(body)).toBe(schemaAccepts(body));
    },
  );

  const stamps: [string, string][] = [
    ['UTC with seconds', '2026-10-13T10:00:00Z'],
    ['fractional seconds', '2026-10-13T10:00:00.123456Z'],
    ['numeric offset', '2026-10-13T10:00:00+02:00'],
    ['negative zero offset', '2026-10-13T10:00:00-00:00'],
    ['leap day', '2028-02-29T10:00:00Z'],
    ['no seconds', '2026-10-13T10:00Z'],
    ['offset without a colon', '2026-10-13T10:00:00+0200'],
    ['hour offset only', '2026-10-13T10:00:00+02'],
    ['space separator', '2026-10-13 10:00:00Z'],
    ['date only', '2026-10-13'],
    ['no zone', '2026-10-13T10:00:00'],
    ['lowercase separators', '2026-10-13t10:00:00z'],
    ['impossible day', '2026-02-30T10:00:00Z'],
    ['not a leap year', '2027-02-29T10:00:00Z'],
    ['hour 24', '2026-10-13T24:00:00Z'],
    ['second 60', '2026-10-13T23:59:60Z'],
    ['offset hour 25', '2026-10-13T10:00:00+25:00'],
    ['offset minute 60', '2026-10-13T10:00:00+02:60'],
    ['leading space', ' 2026-10-13T10:00:00Z'],
    ['trailing newline', '2026-10-13T10:00:00Z\n'],
    ['dangling fraction', '2026-10-13T10:00:00.Z'],
    ['empty', ''],
    ['words', 'tomorrow'],
  ];

  it.each(stamps)(
    'agrees with the schema on a review timestamp: %s',
    async (_name, stamp) => {
      for (const key of ['reviewedAt', 'reviewDueAt']) {
        const body = setPath(policy(), [key], stamp);
        expect(await dbAccepts(body)).toBe(schemaAccepts(body));
      }
    },
  );

  // These are rejected on purpose by the database although the schema accepts them.
  // The installed zod counts string length in code points, while hs.text_length
  // (migration 0001) counts UTF-16 units, so 151 to 300 astral characters pass the schema.
  it.each<[string, string[], unknown]>([
    [
      'a coverage gap of 151 astral characters',
      ['capabilities', 'coverageGaps'],
      ['\u{1F600}'.repeat(151)],
    ],
    [
      'a valid punycode host, which hs.valid_bookmark_url also refuses',
      ['listingOrigins'],
      ['https://xn--bcher-kva.example'],
    ],
    ['an ftp origin', ['listingOrigins'], ['ftp://example.invalid']],
    ['a websocket origin', ['imageOrigins'], ['wss://example.invalid']],
    ['an IPv6 origin', ['listingOrigins'], ['https://[::1]']],
    ['an underscore host origin', ['listingOrigins'], ['https://a_b.example']],
    ['a revision above the int range', ['revision'], 2_147_483_648],
    [
      'a result cap above the int range',
      ['capabilities', 'resultCap'],
      2_147_483_648,
    ],
  ])('is stricter than the schema for %s', async (_name, path, replacement) => {
    const body = setPath(policy(), path, replacement);
    expect(schemaAccepts(body)).toBe(true);
    expect(await dbAccepts(body)).toBe(false);
  });

  // The schema refinement calls new URL(), which throws for a host whose last label
  // is numeric or 0x hex unless the host is an IPv4 address, and for a bad punycode
  // label. The Edge function must never be handed a policy it cannot parse.
  function schemaOutcome(body: unknown) {
    try {
      return sourcePolicySchema.safeParse(JSON.parse(JSON.stringify(body)))
        .success
        ? 'accepts'
        : 'rejects';
    } catch {
      return 'throws';
    }
  }

  it.each([
    'https://example.123',
    'https://a.b.c.4',
    'https://a.0x',
    'https://a.0x7f',
    'https://xn--a',
    'https://xn--ab.com',
    'https://0x7f000001',
    'https://0x7f.0.0.1',
    'https://a.b.0xff',
    'https://example.com.1',
    'https://1.2.3',
    'https://1.2.3.4.5',
    'https://999.1.1.1',
    'https://256.1.1.1',
    'https://1.2.3.4.',
    'https://a.1.',
    'https://127.1',
    'https://0177.0.0.1',
    'https://2130706433',
    'https://01.2.3.4',
    'https://1',
    'https://0',
    'https://example.invalid:99999',
  ])('refuses the origin %s that the schema cannot parse', async (origin) => {
    const body = setPath(policy(), ['listingOrigins'], [origin]);
    expect(['rejects', 'throws']).toContain(schemaOutcome(body));
    expect(await dbAccepts(body)).toBe(false);
    const images = setPath(policy(), ['imageOrigins'], [origin]);
    expect(['rejects', 'throws']).toContain(schemaOutcome(images));
    expect(await dbAccepts(images)).toBe(false);
  });

  it('still accepts hosts the schema accepts, including a final label that only starts like a number', async () => {
    for (const origin of [
      'https://127.0.0.1',
      'https://255.255.255.255',
      'https://0.0.0.0',
      'https://a.0xg',
      'https://a.1a',
      'https://a.b1',
      'https://1a.example',
      'https://0x7f.example',
      'https://a.com.',
      'https://localhost',
    ]) {
      const body = setPath(policy(), ['listingOrigins'], [origin]);
      expect(schemaOutcome(body)).toBe('accepts');
      expect(await dbAccepts(body)).toBe(true);
    }
  });

  it('never accepts an origin host that the schema rejects or throws on, over every short label combination', async () => {
    const labels = [
      'a',
      'b1',
      '1',
      '0',
      '12',
      '256',
      '0x',
      '0x7f',
      '0xg',
      '00',
      '08',
      'xn--',
      'xn--a',
      '-',
      '',
      'com',
    ];
    const hosts: string[] = [];
    const build = (prefix: string[]) => {
      if (prefix.length > 0) hosts.push(prefix.join('.'));
      if (prefix.length === 3) return;
      for (const label of labels) build([...prefix, label]);
    };
    build([]);
    const origins = hosts.map((host) => `https://${host}`);
    const verdicts = await db.query<{ origin: string; valid: boolean }>(
      `select o origin,hs.valid_policy(jsonb_set($1::jsonb,'{listingOrigins}',jsonb_build_array(o))) valid from unnest($2::text[]) o`,
      [JSON.stringify(policy()), arrayLiteral(origins)],
    );
    expect(verdicts.rows).toHaveLength(origins.length);
    const leaked = verdicts.rows
      .filter((row) => row.valid)
      .map((row) => row.origin)
      .filter(
        (origin) =>
          schemaOutcome(setPath(policy(), ['listingOrigins'], [origin])) !==
          'accepts',
      );
    expect(leaked).toEqual([]);
    const outcomes = origins.map((origin) =>
      schemaOutcome(setPath(policy(), ['listingOrigins'], [origin])),
    );
    // The sweep is only meaningful if it contains both kinds of host. The
    // schema used to throw on some of them; it now rejects them cleanly.
    expect(outcomes.filter((outcome) => outcome === 'throws')).toHaveLength(0);
    expect(
      outcomes.filter((outcome) => outcome === 'rejects').length,
    ).toBeGreaterThan(500);
    expect(
      outcomes.filter((outcome) => outcome === 'accepts').length,
    ).toBeGreaterThan(500);
    expect(verdicts.rows.filter((row) => row.valid).length).toBeGreaterThan(
      500,
    );
  });

  it('is stricter than the schema for a retention written as 30.0', async () => {
    const text = JSON.stringify(policy()).replace(
      '"retentionDays":30',
      '"retentionDays":30.0',
    );
    expect(text).toContain('"retentionDays":30.0');
    expect(sourcePolicySchema.safeParse(JSON.parse(text)).success).toBe(true);
    expect(
      await value('select hs.valid_policy($1::jsonb) as value', [text]),
    ).toBe(false);
  });

  it('rejects null and non object input', async () => {
    for (const body of ['null', '[]', '"alpha"', '1', 'true'])
      expect(
        await value('select hs.valid_policy($1::jsonb) as value', [body]),
      ).toBe(false);
    expect(await value('select hs.valid_policy(null) as value')).toBe(false);
  });

  it('accepts the approved Boneo policy the collector prints', async () => {
    const { householdId } = await bootstrap();
    const printed = approvedPolicy('boneo');
    expect(sourcePolicySchema.safeParse(printed).success).toBe(true);
    expect(
      await value('select hs.valid_policy($1::jsonb) as value', [
        JSON.stringify(printed),
      ]),
    ).toBe(true);
    expect(await setPolicy(householdId, printed)).toEqual({
      sourceId: 'boneo',
      created: true,
      revision: printed.revision,
    });
  });
  it('creates a policy with a null cursor and logs the keys it set', async () => {
    const { householdId } = await bootstrap();
    const { result, entry } = await expectOneLogRow(
      () => setPolicy(householdId, policy()),
      'set_source_policy',
    );
    expect(result).toEqual({ sourceId: 'alpha', created: true, revision: 1 });
    expect(entry.household_id).toBe(householdId);
    expect(entry.subject_user_id).toBeNull();
    expect(entry.detail).toMatchObject({
      sourceId: 'alpha',
      created: true,
      status: { old: null, new: 'approved' },
      revision: { old: null, new: 1 },
      retentionDays: { old: null, new: 30 },
    });
    expect(entry.detail.changedKeys).toEqual(Object.keys(policy()).sort());
    const stored = await db.query(
      'select policy,cursor from hs.source_policies where household_id=$1',
      [householdId],
    );
    expect(stored.rows).toEqual([{ policy: policy(), cursor: null }]);
  });

  it('keeps the stored cursor on update and logs old and new values', async () => {
    const { householdId, profileId } = await seedHousehold();
    await publishListing(profileId, 'home', aged(0), 'cursor-kept');
    const cursor = async () =>
      value(
        "select cursor as value from hs.source_policies where household_id=$1 and source_id='alpha'",
        [householdId],
      );
    expect(await cursor()).toBe('cursor-kept');
    const { result, entry } = await expectOneLogRow(
      () =>
        setPolicy(
          householdId,
          policy('alpha', {
            revision: 2,
            retentionDays: 14,
            status: 'pending',
          }),
        ),
      'set_source_policy',
    );
    expect(result).toEqual({ sourceId: 'alpha', created: false, revision: 2 });
    expect(await cursor()).toBe('cursor-kept');
    expect(entry.detail).toMatchObject({
      created: false,
      status: { old: 'approved', new: 'pending' },
      revision: { old: 1, new: 2 },
      retentionDays: { old: 30, new: 14 },
      changedKeys: ['retentionDays', 'revision', 'status'],
    });
    const stored = await db.query(
      "select policy->>'retentionDays' retention from hs.source_policies where household_id=$1",
      [householdId],
    );
    expect(stored.rows).toEqual([{ retention: '14' }]);
  });

  it('rejects an equal or lower revision and writes nothing', async () => {
    const { householdId } = await seedHousehold();
    await setPolicy(householdId, policy('alpha', { revision: 5 }));
    for (const revision of [5, 4, 1])
      await expectNothingWritten(
        () =>
          setPolicy(
            householdId,
            policy('alpha', { revision, retentionDays: 7 }),
          ),
        'Policy revision must increase',
      );
    expect(
      await setPolicy(householdId, policy('alpha', { revision: 6 })),
    ).toMatchObject({ revision: 6 });
  });

  it('rejects an invalid policy, a null policy and an unknown household and writes nothing', async () => {
    const { householdId } = await seedHousehold();
    for (const body of [
      setPath(policy(), ['retentionDays'], 181),
      setPath(policy(), ['reviewDueAt'], 'next week'),
      setPath(policy(), ['capabilities', 'coverageGaps'], 'none'),
      setPath(policy('alpha', { revision: 9 }), ['extra'], true),
      null,
    ])
      await expectNothingWritten(
        () => setPolicy(householdId, body),
        'Invalid source policy',
      );
    await expectNothingWritten(
      () => setPolicy(randomUUID(), policy('beta')),
      'Household unavailable',
    );
  });

  it('writes only the named household', async () => {
    const first = await seedHousehold();
    const second = await bootstrap({ owner: OTHER_OWNER, name: 'Second' });
    const before = await db.query(
      "select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) digest from hs.source_policies t where household_id=$1",
      [first.householdId],
    );
    await setPolicy(second.householdId, policy('alpha'));
    await setPolicy(second.householdId, policy('alpha', { revision: 2 }));
    const after = await db.query(
      "select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) digest from hs.source_policies t where household_id=$1",
      [first.householdId],
    );
    expect(after.rows).toEqual(before.rows);
  });
});

describe('credentials', () => {
  it('registers an ingest credential row without any secret and the service role can use it', async () => {
    const { householdId } = await bootstrap();
    await setPolicy(householdId, policy('alpha'));
    await setPolicy(householdId, policy('beta'));
    const expiresAt = new Date(Date.now() + 89 * DAY).toISOString();
    const { result, entry } = await expectOneLogRow(
      () => issue(householdId, KEY, ['alpha', 'beta'], expiresAt),
      'issue_credential',
    );
    expect(result.keyId).toBe(KEY);
    expect(result.sourceIds).toEqual(['alpha', 'beta']);
    expect(new Date(result.expiresAt).getTime()).toBe(
      new Date(expiresAt).getTime(),
    );
    expect(entry).toMatchObject({
      household_id: householdId,
      subject_user_id: null,
      detail: { keyId: KEY, sourceIds: ['alpha', 'beta'] },
    });
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_schema='hs' and table_name='ingest_credentials' order by column_name",
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'expires_at',
      'household_id',
      'key_id',
      'revoked_at',
      'scopes',
      'source_ids',
    ]);
    const stored = await db.query(
      'select household_id,source_ids,scopes,revoked_at from hs.ingest_credentials where key_id=$1',
      [KEY],
    );
    expect(stored.rows).toEqual([
      {
        household_id: householdId,
        source_ids: ['alpha', 'beta'],
        scopes: ['ingest'],
        revoked_at: null,
      },
    ]);
    expect(
      await asRole('service_role', null, () =>
        value('select public.hs_ingest_credential($1) as value', [KEY]),
      ),
    ).toEqual({
      householdId,
      sourceIds: ['alpha', 'beta'],
      scopes: ['ingest'],
    });
  });

  it.each<
    [string, string, (string | null)[] | null, () => string | null, string]
  >([
    [
      'an unknown source id',
      'k-unknown',
      ['zeta'],
      () => inDays(5),
      'Unknown source',
    ],
    [
      'one unknown source id among known ones',
      'k-mixed',
      ['alpha', 'zeta'],
      () => inDays(5),
      'Unknown source',
    ],
    ['no source ids', 'k-none', [], () => inDays(5), 'Invalid credential'],
    [
      'a null source list',
      'k-null',
      null,
      () => inDays(5),
      'Invalid credential',
    ],
    [
      'a null source id',
      'k-nullid',
      ['alpha', null],
      () => inDays(5),
      'Invalid credential',
    ],
    [
      'a repeated source id',
      'k-repeat',
      ['alpha', 'alpha'],
      () => inDays(5),
      'Invalid credential',
    ],
    [
      'more than 20 source ids',
      'k-many',
      Array.from({ length: 21 }, (_, i) => `s${i}`),
      () => inDays(5),
      'Invalid credential',
    ],
    [
      'an expiry in the past',
      'k-past',
      ['alpha'],
      () => inDays(-1),
      'Invalid credential',
    ],
    [
      'an expiry of now',
      'k-now',
      ['alpha'],
      () => new Date().toISOString(),
      'Invalid credential',
    ],
    [
      'an expiry 91 days out',
      'k-long',
      ['alpha'],
      () => inDays(91),
      'Invalid credential',
    ],
    [
      'a year long expiry',
      'k-year',
      ['alpha'],
      () => inDays(365),
      'Invalid credential',
    ],
    ['a null expiry', 'k-noexp', ['alpha'], () => null, 'Invalid credential'],
    ['an empty key id', '', ['alpha'], () => inDays(5), 'Invalid credential'],
    [
      'a key id with a space',
      'bad key',
      ['alpha'],
      () => inDays(5),
      'Invalid credential',
    ],
    [
      'a key id over 80 characters',
      'k'.repeat(81),
      ['alpha'],
      () => inDays(5),
      'Invalid credential',
    ],
  ])(
    'rejects %s and writes nothing',
    async (_name, key, sources, expiry, message) => {
      const { householdId } = await bootstrap();
      await setPolicy(householdId, policy('alpha'));
      await expectNothingWritten(
        () => issue(householdId, key, sources, expiry()),
        message,
      );
    },
  );

  it('rejects a source that only another household has a policy for', async () => {
    const first = await bootstrap();
    const second = await bootstrap({ owner: OTHER_OWNER, name: 'Second' });
    await setPolicy(first.householdId, policy('alpha'));
    await setPolicy(second.householdId, policy('beta'));
    await expectNothingWritten(
      () => issue(first.householdId, 'k-cross', ['beta'], inDays(5)),
      'Unknown source',
    );
    await expectNothingWritten(
      () => issue(randomUUID(), 'k-house', ['alpha'], inDays(5)),
      'Household unavailable',
    );
    await expectNothingWritten(
      () => issue(null, 'k-null', ['alpha'], inDays(5)),
      'Household unavailable',
    );
  });

  it('rejects a source list that is not one-dimensional', async () => {
    const { householdId } = await bootstrap();
    await setPolicy(householdId, policy('alpha'));
    await setPolicy(householdId, policy('beta'));
    const call = (literal: string) =>
      value(
        'select hs.admin_issue_credential($1,$2,$3::text[],$4::timestamptz) as value',
        [householdId, 'k-shape', literal, inDays(5)],
      );
    await expectNothingWritten(
      () => call('{{alpha},{beta}}'),
      'Invalid credential',
    );
    await expectNothingWritten(
      () => call('{{alpha,beta}}'),
      'Invalid credential',
    );
    await call('{alpha,beta}');
    expect(
      await count(
        'select count(*)::int count from hs.ingest_credentials where key_id=$1',
        ['k-shape'],
      ),
    ).toBe(1);
  });

  // A zone whose DST ends inside the next 90 days makes '90 days' of local time
  // 2161 hours. The zone is a POSIX rule built from today's date so the test does
  // not depend on when it runs.
  it('caps the expiry at 2160 hours even when a DST change falls inside the window', async () => {
    const { householdId } = await bootstrap();
    await setPolicy(householdId, policy('alpha'));
    const dayOfYear = (date: Date) =>
      Math.min(
        365,
        Math.floor(
          (date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 0)) / DAY,
        ),
      );
    const start = dayOfYear(new Date(Date.now() - 30 * DAY));
    const end = dayOfYear(new Date(Date.now() + 45 * DAY));
    await db.exec(`set time zone 'ZZA0ZZB,J${start},J${end}'`);
    try {
      const hours = await value(
        "select extract(epoch from (now()+interval '90 days')-now())/3600 as value",
      );
      expect(Number(hours)).toBe(2161);
      const inside = new Date(Date.now() + 2160 * HOUR - 60_000).toISOString();
      const outside = new Date(Date.now() + 2160 * HOUR + 60_000).toISOString();
      await expectNothingWritten(
        () => issue(householdId, 'k-dst-out', ['alpha'], outside),
        'Invalid credential',
      );
      await issue(householdId, 'k-dst-in', ['alpha'], inside);
    } finally {
      await db.exec('reset time zone');
    }
  });

  it('accepts an expiry just inside 90 days and refuses to reuse a key id', async () => {
    const { householdId } = await bootstrap();
    await setPolicy(householdId, policy('alpha'));
    const edge = new Date(Date.now() + 90 * DAY - 60_000).toISOString();
    await issue(householdId, KEY, ['alpha'], edge);
    await expectNothingWritten(
      () => issue(householdId, KEY, ['alpha'], inDays(5)),
      'Credential key id already used',
    );
    await revoke(KEY);
    await expectNothingWritten(
      () => issue(householdId, KEY, ['alpha'], inDays(5)),
      'Credential key id already used',
    );
  });

  it('revokes a credential so that the service role no longer sees it', async () => {
    const { householdId, profileId } = await seedHousehold();
    const lookup = () =>
      asRole('service_role', null, () =>
        value('select public.hs_ingest_credential($1) as value', [KEY]),
      );
    expect(await lookup()).not.toBeNull();
    const { result, entry } = await expectOneLogRow(
      () => revoke(KEY),
      'revoke_credential',
    );
    expect(entry).toMatchObject({
      household_id: householdId,
      subject_user_id: null,
      detail: { keyId: KEY },
    });
    expect(await lookup()).toBeNull();
    const stored = await db.query<{ revoked_at: Date }>(
      'select revoked_at from hs.ingest_credentials where key_id=$1',
      [KEY],
    );
    expect(stored.rows[0].revoked_at.toISOString()).toBe(
      new Date(result.revokedAt).toISOString(),
    );
    await expect(
      ingest({
        action: 'begin',
        contractVersion: 1,
        runId: randomUUID(),
        sourceIds: ['alpha'],
        profileVersions: [{ profileId, revision: 1 }],
      }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      asRole('service_role', null, () =>
        value('select public.hs_ingest_policies($1) as value', [KEY]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects revoking an unknown or already revoked key and keeps the first revocation', async () => {
    await seedHousehold();
    await expectNothingWritten(
      () => revoke('no-such-key'),
      'Credential unavailable',
    );
    await expectNothingWritten(() => revoke(null), 'Credential unavailable');
    await revoke(KEY);
    const first = await db.query(
      'select revoked_at from hs.ingest_credentials where key_id=$1',
      [KEY],
    );
    await expectNothingWritten(() => revoke(KEY), 'Credential already revoked');
    const second = await db.query(
      'select revoked_at from hs.ingest_credentials where key_id=$1',
      [KEY],
    );
    expect(second.rows).toEqual(first.rows);
  });

  it('revokes an already expired credential', async () => {
    await seedHousehold();
    await db.query(
      "update hs.ingest_credentials set expires_at=now()-interval '1 day' where key_id=$1",
      [KEY],
    );
    await revoke(KEY);
    expect(
      await count(
        'select count(*)::int count from hs.ingest_credentials where revoked_at is not null',
      ),
    ).toBe(1);
  });
});

describe('log and household lock', () => {
  it('appends exactly one row per successful call, in order, and none for failures', async () => {
    const { householdId } = await bootstrap();
    await setMember(householdId, MEMBER);
    await setPolicy(householdId, policy());
    await issue(householdId, KEY, ['alpha'], inDays(5));
    await revoke(KEY);
    await expect(revoke(KEY)).rejects.toThrow();
    await expect(setMember(householdId, UNKNOWN_USER)).rejects.toThrow();
    await expect(
      issue(householdId, 'k2', ['nope'], inDays(5)),
    ).rejects.toThrow();
    await expect(setPolicy(householdId, {})).rejects.toThrow();
    await expect(bootstrap({ name: '' })).rejects.toThrow();
    const rows = await logRows();
    expect(rows.map((row) => row.action)).toEqual([
      'bootstrap_household',
      'set_member',
      'set_source_policy',
      'issue_credential',
      'revoke_credential',
    ]);
    expect(rows.every((row) => row.household_id === householdId)).toBe(true);
    const times = await db.query<{ ordered: boolean }>(
      'select bool_and(logged_at>=lag) ordered from (select logged_at,lag(logged_at) over (order by id) lag from hs.admin_log) t where lag is not null',
    );
    expect(times.rows[0].ordered).toBe(true);
  });

  it('holds no email, name, criteria, policy text or secret', async () => {
    const { householdId } = await seedHousehold();
    await setMember(householdId, MEMBER, { name: 'Zq renamed', active: false });
    await revoke(KEY);
    const text = JSON.stringify(
      (await db.query('select * from hs.admin_log')).rows,
    );
    for (const forbidden of [
      '@',
      'Zq',
      'Synthetic local test permission',
      'municipalities',
      'secret',
      'example.invalid',
    ])
      expect(text).not.toContain(forbidden);
  });

  async function marker(householdId: string) {
    return value('select xmax::text as value from hs.households where id=$1', [
      householdId,
    ]);
  }

  // PGlite has one connection, so contention cannot be reproduced. A row lock
  // writes the locker's transaction id to xmax of the household row. These
  // operations touch no foreign key to the household, so only the explicit lock
  // can change it, and the other household's marker stays put.
  it('locks the named household row for member, policy and revoke writes', async () => {
    const { householdId } = await seedHousehold();
    const other = await bootstrap({ owner: OTHER_OWNER, name: 'Second' });
    for (const call of [
      () => setMember(householdId, MEMBER, { name: 'Renamed' }),
      () => setPolicy(householdId, policy('alpha', { revision: 2 })),
      () => revoke(KEY),
    ]) {
      const before = await marker(householdId);
      const otherBefore = await marker(other.householdId);
      await call();
      expect(await marker(householdId)).not.toBe(before);
      expect(await marker(other.householdId)).toBe(otherBefore);
    }
  });
});

// A member request passes the membership check, then waits for the household lock.
// If the operator deactivates or demotes the member meanwhile, the request must not
// write once it gets the lock. PGlite has one connection, so no real wait happens.
// test_hook runs the operator change at the last auth.uid() call of the first check,
// which leaves the first check passed and the change visible to later statements.
describe('membership is checked again after the household lock', () => {
  type Context = { householdId: string; profileId: string; listing: string };
  const cases: {
    name: string;
    role: 'member' | 'owner';
    demoteOnly: boolean;
    run: (context: Context) => Promise<unknown>;
    written: (context: Context) => Promise<number>;
    before: number;
    after: number;
  }[] = [
    {
      name: 'hs_set_favorite',
      role: 'member',
      demoteOnly: false,
      run: (c) =>
        asRole('authenticated', MEMBER, () =>
          value('select public.hs_set_favorite($1,$2,true) as value', [
            c.householdId,
            c.listing,
          ]),
        ),
      written: () =>
        count('select count(*)::int count from hs.favorites where user_id=$1', [
          MEMBER,
        ]),
      before: 0,
      after: 1,
    },
    {
      name: 'hs_save_note',
      role: 'member',
      demoteOnly: false,
      run: (c) =>
        asRole('authenticated', MEMBER, () =>
          value('select public.hs_save_note($1,$2,$3,0) as value', [
            c.householdId,
            c.listing,
            'Racing note',
          ]),
        ),
      written: () =>
        count('select count(*)::int count from hs.notes where user_id=$1', [
          MEMBER,
        ]),
      before: 0,
      after: 1,
    },
    {
      name: 'hs_add_manual',
      role: 'member',
      demoteOnly: false,
      run: (c) =>
        asRole('authenticated', MEMBER, () =>
          value('select public.hs_add_manual($1,$2,$3,$4,$5::jsonb) as value', [
            c.householdId,
            `${ORIGIN}/racing`,
            'Racing',
            '',
            '[]',
          ]),
        ),
      written: () => count('select count(*)::int count from hs.listings'),
      before: 1,
      after: 2,
    },
    {
      name: 'hs_save_profile',
      role: 'owner',
      demoteOnly: true,
      run: (c) =>
        asRole('authenticated', MEMBER, () =>
          value(
            'select public.hs_save_profile($1,$2,1,$3,true,$4::jsonb) as value',
            [
              c.householdId,
              c.profileId,
              'Racing name',
              JSON.stringify(criteria),
            ],
          ),
        ),
      written: () => count('select max(revision)::int count from hs.profiles'),
      before: 1,
      after: 2,
    },
  ];

  async function seedRace(role: 'member' | 'owner'): Promise<Context> {
    const { householdId, profileId } = await bootstrap();
    await setMember(householdId, MEMBER, { role });
    const added = z
      .strictObject({ listingId: z.uuid(), existing: z.boolean() })
      .parse(
        await asRole('authenticated', OWNER, () =>
          value('select public.hs_add_manual($1,$2,$3,$4,$5::jsonb) as value', [
            householdId,
            `${ORIGIN}/seeded`,
            'Seeded',
            '',
            '[]',
          ]),
        ),
      );
    return { householdId, profileId, listing: added.listingId };
  }

  // The number of auth.uid() calls one membership check makes in the current state.
  async function checkCalls(householdId: string) {
    await db.exec(
      'update public.test_hook set counting=true,calls=0,fire_at=null',
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      MEMBER,
    ]);
    try {
      await db.query('select hs.require_member($1)', [householdId]);
    } finally {
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
    const row = await db.query<{ calls: number }>(
      'select calls from public.test_hook',
    );
    await db.exec('update public.test_hook set counting=false,calls=0');
    return row.rows[0].calls;
  }

  async function arm(householdId: string, fireAt: number, demoteOnly: boolean) {
    await db.query(
      'update public.test_hook set counting=true,calls=0,fire_at=$1,household=$2,victim=$3,demote_only=$4',
      [fireAt, householdId, MEMBER, demoteOnly],
    );
  }

  beforeEach(async () => {
    await db.exec(
      'update public.test_hook set counting=false,calls=0,fire_at=null,household=null,victim=null,demote_only=false',
    );
  });

  it.each(cases)(
    '$name still works for an active member when nothing changes',
    async (item) => {
      const context = await seedRace(item.role);
      expect(await item.written(context)).toBe(item.before);
      await item.run(context);
      expect(await item.written(context)).toBe(item.after);
    },
  );

  it.each(cases)(
    '$name refuses a member who was deactivated or demoted after passing the first check',
    async (item) => {
      const context = await seedRace(item.role);
      const calls = await checkCalls(context.householdId);
      expect(calls).toBeGreaterThan(0);
      await arm(context.householdId, calls, item.demoteOnly);
      await expect(item.run(context)).rejects.toThrow(
        'Household access denied',
      );
      await db.exec('update public.test_hook set counting=false');
      // The refusal can only come from the second check: the first one passed, and the
      // operator change it saw ran in the same transaction, so it rolled back with the call.
      expect(await item.written(context)).toBe(item.before);
    },
  );
});
