import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  expandSnapshot,
  snapshotV2Schema,
} from '@/features/house-scanner/api/snapshot-v2';
import {
  criteriaSchema,
  type IngestRequest,
  ingestRequestSchema,
  observationSchema,
  sourcePolicySchema,
} from '@/features/house-scanner/types/contracts';

// Invitations, household creation with starter criteria, and member management (specs: shared catalog S5).
const OWNER_A = '20000000-0000-4000-8000-0000000000a1';
const MEMBER_A = '20000000-0000-4000-8000-0000000000a2';
const NEWCOMER = '20000000-0000-4000-8000-0000000000b1';
const FRIEND = '20000000-0000-4000-8000-0000000000c1';
const STRANGER = '20000000-0000-4000-8000-0000000000d1';
const UNCONFIRMED = '20000000-0000-4000-8000-0000000000e1';
const EMAIL: Record<string, string> = {
  [OWNER_A]: 'owner-a@example.invalid',
  [MEMBER_A]: 'member-a@example.invalid',
  [NEWCOMER]: 'newcomer@example.invalid',
  [FRIEND]: 'friend@example.invalid',
  [STRANGER]: 'stranger@example.invalid',
  [UNCONFIRMED]: 'unconfirmed@example.invalid',
};
const ORIGIN = 'https://example.invalid';
const HOUR = 3_600_000;
const tokenSchema = z.strictObject({
  id: z.uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.string(),
});

let db: PGlite;
let householdA: string;

async function as<T>(
  role: 'anon' | 'authenticated' | 'service_role',
  userId: string | null,
  action: () => Promise<T>,
) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    userId ?? '',
  ]);
  await db.exec(`set role ${role}`);
  try {
    return await action();
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
}

async function value(sql: string, params: unknown[] = []) {
  return (await db.query<{ value: unknown }>(sql, params)).rows[0]?.value;
}

const call = (user: string | null, sql: string, params: unknown[] = []) =>
  as(user ? 'authenticated' : 'anon', user, () => value(sql, params));

const issue = async (
  user: string,
  purpose: 'create' | 'join',
  household: string,
  email: string | null = null,
) =>
  tokenSchema.parse(
    await call(user, 'select public.hs_invitation_create($1,$2,$3) as value', [
      purpose,
      household,
      email,
    ]),
  ).token;

const reserve = (token: string, email: string) =>
  as('service_role', null, () =>
    value('select public.hs_invitation_reserve($1,$2) as value', [
      token,
      email,
    ]),
  );

const redeem = async (
  user: string,
  token: string,
  householdName: string | null = 'New household',
  displayName = 'Newcomer',
) =>
  z
    .object({ householdId: z.uuid() })
    .parse(
      await call(
        user,
        'select public.hs_invitation_redeem($1,$2,$3) as value',
        [token, householdName, displayName],
      ),
    ).householdId;

const snapshot = async (household: string, user: string) =>
  expandSnapshot(
    snapshotV2Schema.parse(
      await call(user, 'select public.hs_household_snapshot($1) as value', [
        household,
      ]),
    ),
  );

const access = async (household: string, user: string) =>
  z
    .object({
      name: z.string(),
      members: z.array(
        z.object({
          userId: z.uuid(),
          displayName: z.string(),
          role: z.enum(['owner', 'member']),
          active: z.boolean(),
        }),
      ),
      invitations: z.array(z.object({ id: z.uuid(), email: z.string() })),
    })
    .parse(
      await call(user, 'select public.hs_household_access($1) as value', [
        household,
      ]),
    );

const memberships = async (user: string) =>
  z
    .array(z.object({ householdId: z.uuid(), householdName: z.string() }))
    .parse(await call(user, 'select public.hs_memberships() as value'));

async function ingest(request: IngestRequest) {
  const body = JSON.stringify(ingestRequestSchema.parse(request));
  return as('service_role', null, () =>
    value('select public.hs_ingest($1,$2,$3::jsonb) as value', [
      'onboarding-key',
      createHash('sha256').update(body).digest('hex'),
      body,
    ]),
  );
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
  const names = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of names)
    await db.exec(
      await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'),
    );
  for (const [id, email] of Object.entries(EMAIL))
    await db.query('insert into auth.users values($1,$2,$3)', [
      id,
      email,
      id === UNCONFIRMED ? null : new Date().toISOString(),
    ]);
  householdA = z
    .object({ householdId: z.uuid() })
    .parse(
      await value(
        "select hs.admin_bootstrap_household('Household A',$1,'Owner A','Main profile',hs.starter_criteria()) as value",
        [OWNER_A],
      ),
    ).householdId;
  await value(
    "select hs.admin_set_member($1,$2,'Member A','member',true) as value",
    [householdA, MEMBER_A],
  );
  const now = new Date(Date.now() - HOUR).toISOString();
  await value('select hs.admin_set_source_policy($1::jsonb) as value', [
    JSON.stringify(
      sourcePolicySchema.parse({
        sourceId: 'alpha',
        revision: 1,
        status: 'approved',
        reviewedAt: now,
        reviewDueAt: new Date(Date.now() + 30 * 24 * HOUR).toISOString(),
        rightsBasis: 'Synthetic local test permission',
        listingOrigins: [ORIGIN],
        imageOrigins: [],
        allowedEvidenceSubjects: [],
        freeOnly: true,
        automatedCollection: true,
        privateDisplay: true,
        imageDisplay: false,
        imageHotlink: false,
        modelProcessing: false,
        emailDigest: false,
        telegramDigest: false,
        allowedFactFields: [
          'propertyType',
          'tenure',
          'purchase',
          'livingAreaM2',
          'rooms',
          'askingPriceSek',
          'municipality',
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
      }),
    ),
  ]);
  await value(
    "select hs.admin_issue_credential('onboarding-key',array['alpha'],now()+interval '1 day') as value",
  );
  const runId = randomUUID();
  await ingest({
    action: 'begin',
    contractVersion: 1,
    runId,
    sourceIds: ['alpha'],
  });
  await ingest({
    action: 'stage',
    contractVersion: 1,
    runId,
    batchId: randomUUID(),
    sourceId: 'alpha',
    observations: ['fits', 'house'].map((id) =>
      observationSchema.parse({
        sourceListingId: id,
        episodeId: 'synthetic-episode',
        sourceUrl: `${ORIGIN}/${id}`,
        title: id,
        observedAt: now,
        publishedAt: null,
        facts: {
          propertyType: id === 'house' ? 'house' : 'apartment',
          tenure: 'cooperative',
          purchase: true,
          livingAreaM2: 70,
          secondaryAreaM2: null,
          rooms: 3,
          askingPriceSek: 3_000_000,
          groundFloor: null,
          lift: null,
          liftServesHome: null,
          stepFree: null,
          outdoor: null,
          glazed: null,
          largePrivateTerrace: null,
          municipality: 'Göteborg',
          baseFeeSek: null,
          mandatoryMonthlySek: null,
          status: 'available',
        },
        conflicts: [],
        coordinates: null,
        evidence: [],
        photo: null,
      }),
    ),
  });
  await ingest({
    action: 'publish',
    contractVersion: 1,
    runId,
    results: [
      {
        sourceId: 'alpha',
        status: 'partial',
        coverageNote: 'Synthetic',
        cursor: null,
      },
    ],
  });
  const fits = await value(
    "select id as value from hs.listings where source_listing_id='fits'",
  );
  await call(MEMBER_A, 'select public.hs_set_favorite($1,$2,true) as value', [
    householdA,
    fits,
  ]);
});

afterAll(async () => {
  await db?.close();
});

describe('create-household links', () => {
  let created: string;

  it('lets any active member issue one, and nobody else', async () => {
    expect(await issue(MEMBER_A, 'create', householdA)).toMatch(
      /^[a-f0-9]{64}$/,
    );
    await expect(issue(STRANGER, 'create', householdA)).rejects.toThrow(
      'Household access denied',
    );
  });

  it('previews without the email and binds to the first reserved address', async () => {
    const token = await issue(OWNER_A, 'create', householdA);
    expect(
      await call(null, 'select public.hs_invitation_preview($1) as value', [
        token,
      ]),
    ).toMatchObject({ valid: true, purpose: 'create', issuerName: 'Owner A' });
    await expect(
      call(null, 'select public.hs_invitation_reserve($1,$2) as value', [
        token,
        EMAIL[NEWCOMER],
      ]),
    ).rejects.toThrow('permission denied');
    expect(await reserve(token, EMAIL[NEWCOMER].toUpperCase())).toEqual({
      ok: true,
      purpose: 'create',
    });
    expect(await reserve(token, EMAIL[NEWCOMER])).toMatchObject({ ok: true });
    expect(await reserve(token, EMAIL[STRANGER])).toEqual({ ok: false });
    await expect(redeem(STRANGER, token)).rejects.toThrow(
      'Invitation unavailable',
    );
    created = await redeem(NEWCOMER, token, 'Newcomer home', 'Newcomer');
    await expect(redeem(NEWCOMER, token)).rejects.toThrow(
      'Invitation unavailable',
    );
    expect(
      await call(null, 'select public.hs_invitation_preview($1) as value', [
        token,
      ]),
    ).toEqual({ valid: false });
  });

  it('creates a separate household with a starter profile that browses the catalog', async () => {
    const state = await snapshot(created, NEWCOMER);
    expect(state.members).toEqual([
      expect.objectContaining({ userId: NEWCOMER, role: 'owner' }),
    ]);
    expect(state.profiles).toHaveLength(1);
    expect(criteriaSchema.safeParse(state.profiles[0].criteria).success).toBe(
      true,
    );
    // The apartment fits the starter criteria; the house does not. Household A's favorite is not visible.
    expect(state.listings.map((item) => item.title)).toEqual(['fits']);
    expect(state.favorites).toEqual([]);
    await expect(snapshot(householdA, NEWCOMER)).rejects.toThrow(
      'Household access denied',
    );
    expect(await memberships(NEWCOMER)).toEqual([
      expect.objectContaining({
        householdId: created,
        householdName: 'Newcomer home',
      }),
    ]);
    // The starter profile edits like any other.
    await call(
      NEWCOMER,
      'select public.hs_save_profile($1,$2,1,$3,true,$4::jsonb) as value',
      [
        created,
        state.profiles[0].id,
        'Main profile',
        JSON.stringify({
          ...state.profiles[0].criteria,
          minAreaM2: 80,
          geography: {
            ...state.profiles[0].criteria.geography,
            mode: 'radius',
            radiusKm: 1,
          },
        }),
      ],
    );
    const saved = await snapshot(created, NEWCOMER);
    expect(saved.listings).toEqual([]);
    expect(saved.profiles[0].criteria.geography).toMatchObject({
      mode: 'radius',
      radiusKm: 1,
    });
    for (const [mode, expected] of [
      ['municipalities', true],
      ['other', false],
      [null, false],
    ] as const) {
      const criteria = {
        ...saved.profiles[0].criteria,
        geography: { ...saved.profiles[0].criteria.geography, mode },
      };
      expect(
        await value('select hs.valid_criteria($1::jsonb) as value', [
          JSON.stringify(criteria),
        ]),
      ).toBe(expected);
      expect(criteriaSchema.safeParse(criteria).success).toBe(expected);
    }
  });

  it('accepts an unbound link for a signed-in account, but never an unconfirmed one', async () => {
    const token = await issue(OWNER_A, 'create', householdA);
    await expect(redeem(UNCONFIRMED, token)).rejects.toThrow(
      'Confirm your email before accepting',
    );
    await expect(redeem(MEMBER_A, token, ' ', 'Member A')).rejects.toThrow(
      'Invalid name',
    );
    const second = await redeem(MEMBER_A, token, 'Second home', 'Member A');
    expect((await memberships(MEMBER_A)).map((m) => m.householdId)).toEqual(
      expect.arrayContaining([householdA, second]),
    );
  });

  it('refuses an expired link', async () => {
    const expired = await issue(OWNER_A, 'create', householdA);
    await db.query(
      "update hs.invitations set expires_at=now()-interval '1 second' where token_hash=hs.token_hash($1)",
      [expired],
    );
    expect(await reserve(expired, EMAIL[STRANGER])).toEqual({ ok: false });
    await expect(redeem(STRANGER, expired)).rejects.toThrow(
      'Invitation unavailable',
    );
  });
});

describe('join links', () => {
  let household: string;

  beforeAll(async () => {
    household = await redeem(
      FRIEND,
      await issue(OWNER_A, 'create', householdA),
      'Friend home',
      'Friend',
    );
  });

  it('only an owner issues one, for one email, and only that account can use it', async () => {
    await expect(
      issue(OWNER_A, 'join', household, EMAIL[STRANGER]),
    ).rejects.toThrow('Household access denied');
    await expect(
      issue(FRIEND, 'join', household, 'not an email'),
    ).rejects.toThrow('Invalid email');
    const token = await issue(FRIEND, 'join', household, EMAIL[STRANGER]);
    expect(await reserve(token, EMAIL[NEWCOMER])).toEqual({ ok: false });
    await expect(redeem(NEWCOMER, token, null, 'Newcomer')).rejects.toThrow(
      'Invitation unavailable',
    );
    expect(
      await call(null, 'select public.hs_invitation_preview($1) as value', [
        token,
      ]),
    ).toMatchObject({
      valid: true,
      purpose: 'join',
      householdName: 'Friend home',
    });
    expect(
      (await access(household, FRIEND)).invitations.map((item) => item.email),
    ).toEqual([EMAIL[STRANGER]]);
    expect(await redeem(STRANGER, token, null, 'Stranger')).toBe(household);
    const members = (await access(household, STRANGER)).members;
    expect(members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: STRANGER, role: 'member' }),
      ]),
    );
    // Only owners see pending links.
    expect((await access(household, STRANGER)).invitations).toEqual([]);
  });

  it('replaces an earlier link for the same email and lets an owner revoke links', async () => {
    const first = await issue(FRIEND, 'join', household, EMAIL[NEWCOMER]);
    const second = await issue(FRIEND, 'join', household, EMAIL[NEWCOMER]);
    await expect(redeem(NEWCOMER, first, null, 'Newcomer')).rejects.toThrow(
      'Invitation unavailable',
    );
    const pending = (await access(household, FRIEND)).invitations;
    expect(pending).toHaveLength(1);
    await expect(
      call(STRANGER, 'select public.hs_invitation_revoke($1,$2) as value', [
        household,
        pending[0].id,
      ]),
    ).rejects.toThrow('Household access denied');
    await call(FRIEND, 'select public.hs_invitation_revoke($1,$2) as value', [
      household,
      pending[0].id,
    ]);
    await expect(redeem(NEWCOMER, second, null, 'Newcomer')).rejects.toThrow(
      'Invitation unavailable',
    );
  });

  it('stops working when the issuer is no longer an owner', async () => {
    await call(FRIEND, 'select public.hs_member_make_owner($1,$2) as value', [
      household,
      STRANGER,
    ]);
    const token = await issue(STRANGER, 'join', household, EMAIL[NEWCOMER]);
    await db.query(
      "update hs.members set role='member' where household_id=$1 and user_id=$2",
      [household, STRANGER],
    );
    expect(await reserve(token, EMAIL[NEWCOMER])).toEqual({ ok: false });
  });

  it('keeps a household to ten member rows', async () => {
    const crowded = await redeem(
      NEWCOMER,
      await issue(OWNER_A, 'create', householdA),
      'Crowded home',
      'Newcomer',
    );
    for (let index = 0; index < 9; index += 1) {
      const id = randomUUID();
      await db.query('insert into auth.users values($1,$2,now())', [
        id,
        `filler-${index}@example.invalid`,
      ]);
      await db.query(
        "insert into hs.members(household_id,user_id,display_name,role) values($1,$2,'Filler','member')",
        [crowded, id],
      );
    }
    const token = await issue(NEWCOMER, 'join', crowded, EMAIL[FRIEND]);
    await expect(redeem(FRIEND, token, null, 'Friend')).rejects.toThrow(
      'Household member limit reached',
    );
  });
});

describe('leaving and member management', () => {
  let household: string;
  const leaver = '20000000-0000-4000-8000-0000000000f1';

  beforeAll(async () => {
    await db.query('insert into auth.users values($1,$2,now())', [
      leaver,
      'leaver@example.invalid',
    ]);
    household = await redeem(
      leaver,
      await issue(OWNER_A, 'create', householdA),
      'Leaving home',
      'Leaver',
    );
    await redeem(
      STRANGER,
      await issue(leaver, 'join', household, EMAIL[STRANGER]),
      null,
      'Stranger',
    );
  });

  it('asks the last owner to make someone an owner before leaving', async () => {
    await expect(
      call(leaver, 'select public.hs_household_leave($1) as value', [
        household,
      ]),
    ).rejects.toThrow('Make another member an owner before leaving');
    await expect(
      call(STRANGER, 'select public.hs_household_rename($1,$2) as value', [
        household,
        'Not mine',
      ]),
    ).rejects.toThrow('Household access denied');
    await call(leaver, 'select public.hs_household_rename($1,$2) as value', [
      household,
      ' Renamed home ',
    ]);
    expect((await access(household, STRANGER)).name).toBe('Renamed home');
  });

  it('lets an owner deactivate others but not themselves, and a member return with their saves', async () => {
    const fits = await value(
      "select id as value from hs.listings where source_listing_id='fits'",
    );
    await call(STRANGER, 'select public.hs_set_favorite($1,$2,true) as value', [
      household,
      fits,
    ]);
    await expect(
      call(leaver, 'select public.hs_member_deactivate($1,$2) as value', [
        household,
        leaver,
      ]),
    ).rejects.toThrow('Use leave to remove yourself');
    await call(leaver, 'select public.hs_member_deactivate($1,$2) as value', [
      household,
      STRANGER,
    ]);
    await expect(snapshot(household, STRANGER)).rejects.toThrow(
      'Household access denied',
    );
    await redeem(
      STRANGER,
      await issue(leaver, 'join', household, EMAIL[STRANGER]),
      null,
      'Stranger again',
    );
    const state = await snapshot(household, STRANGER);
    expect(state.favorites.map((item) => item.userId)).toEqual([STRANGER]);
    expect(
      (await access(household, STRANGER)).members.filter(
        (item) => item.userId === STRANGER,
      ),
    ).toEqual([
      expect.objectContaining({ displayName: 'Stranger again', active: true }),
    ]);
  });

  it('leaves once another owner exists, and the last member archives the household', async () => {
    await call(leaver, 'select public.hs_member_make_owner($1,$2) as value', [
      household,
      STRANGER,
    ]);
    expect(
      await call(leaver, 'select public.hs_household_leave($1) as value', [
        household,
      ]),
    ).toEqual({ archived: false });
    const pending = await issue(STRANGER, 'join', household, EMAIL[NEWCOMER]);
    expect(
      await call(STRANGER, 'select public.hs_household_leave($1) as value', [
        household,
      ]),
    ).toEqual({ archived: true });
    expect(
      (await memberships(STRANGER)).some((m) => m.householdId === household),
    ).toBe(false);
    expect(await reserve(pending, EMAIL[NEWCOMER])).toEqual({ ok: false });
    expect(
      await value(
        'select archived_at is not null as value from hs.households where id=$1',
        [household],
      ),
    ).toBe(true);
    // Nothing is deleted.
    expect(
      await value(
        'select count(*)::int as value from hs.favorites where household_id=$1',
        [household],
      ),
    ).toBe(1);
  });
});

describe('onboarding grants and rollback', () => {
  it('rolls location validation back without silently discarding saved modes', async () => {
    const isolated = await db.clone();
    const read = (folder: string) =>
      readFile(
        new URL(
          `../${folder}/20261022171317_house_scanner_location_mode${folder === 'rollbacks' ? '_down' : ''}.sql`,
          import.meta.url,
        ),
        'utf8',
      );
    try {
      const legacy = await value('select hs.starter_criteria() as value');
      const withMode = {
        ...criteriaSchema.parse(legacy),
        geography: {
          ...criteriaSchema.parse(legacy).geography,
          mode: 'radius',
        },
      };
      const down = await read('rollbacks');
      await expect(isolated.exec(down)).rejects.toThrow(
        'Restore profiles to legacy location criteria',
      );
      await isolated.exec(
        "update hs.profiles set criteria=criteria #- '{geography,mode}' where criteria->'geography' ? 'mode'",
      );
      await isolated.exec(down);
      expect(
        (
          await isolated.query<{ valid: boolean }>(
            'select hs.valid_criteria($1::jsonb) as valid',
            [JSON.stringify(withMode)],
          )
        ).rows[0].valid,
      ).toBe(false);
      expect(
        (
          await isolated.query<{ valid: boolean }>(
            'select hs.valid_criteria($1::jsonb) as valid',
            [JSON.stringify(legacy)],
          )
        ).rows[0].valid,
      ).toBe(true);
      await isolated.exec(await read('migrations'));
      expect(
        (
          await isolated.query<{ valid: boolean }>(
            'select hs.valid_criteria($1::jsonb) as valid',
            [JSON.stringify(withMode)],
          )
        ).rows[0].valid,
      ).toBe(true);
    } finally {
      await isolated.close();
    }
  });

  it('keeps the invitations table private', async () => {
    await expect(
      as('authenticated', OWNER_A, () =>
        value('select count(*) as value from hs.invitations'),
      ),
    ).rejects.toThrow('permission denied');
    await expect(
      call(null, 'select public.hs_invitation_create($1,$2,null) as value', [
        'create',
        householdA,
      ]),
    ).rejects.toThrow('permission denied');
  });

  it('rolls back and applies again', async () => {
    const name = '20261020155317_house_scanner_onboarding';
    await db.exec(
      await readFile(
        new URL(`../rollbacks/${name}_down.sql`, import.meta.url),
        'utf8',
      ),
    );
    expect(
      await call(OWNER_A, 'select public.hs_memberships() as value'),
    ).toEqual([
      expect.not.objectContaining({ householdName: expect.anything() }),
    ]);
    await db.exec(
      await readFile(
        new URL(`../migrations/${name}.sql`, import.meta.url),
        'utf8',
      ),
    );
    expect((await memberships(OWNER_A)).map((m) => m.householdName)).toEqual([
      'Household A',
    ]);
  });
});
