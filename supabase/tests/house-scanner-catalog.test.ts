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
import {
  HARD_RULE_BASE_FACTS,
  HARD_RULE_CASES,
  HARD_RULE_CRITERIA,
} from '@/features/house-scanner/utils/hard-rule-cases';

// The shared catalog migration (S1): one household's data before it, many households after it.
const CATALOG = '20261020111540_house_scanner_catalog.sql';
// Drops the old snapshot functions (spec: house-scanner-v2-client, S2).
const DROP_OLD = '20261022143306_house_scanner_drop_old_snapshot';
const HOUSE_A = '10000000-0000-4000-8000-000000000001';
const HOUSE_B = '10000000-0000-4000-8000-000000000002';
const OWNER_A = '20000000-0000-4000-8000-000000000001';
const MEMBER_A = '20000000-0000-4000-8000-000000000002';
const OWNER_B = '20000000-0000-4000-8000-000000000003';
const PROFILE_A = '30000000-0000-4000-8000-000000000001';
const PROFILE_B = '30000000-0000-4000-8000-000000000002';
const KEY = 'synthetic-key-a';
const ORIGIN = 'https://example.invalid';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const baseTime = Date.now() - 4 * HOUR;
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
  geography: {
    municipalities: ['Synthetic municipality'],
    center: [0, 0],
    radiusKm: 10,
  },
  nature: { preferImmediateGreenery: false, preferredWalkMinutes: 10 },
  transit: {
    preferredWalkMinutes: 10,
    preferredJourneyMinutes: 30,
    tradeoffJourneyMinutes: 60,
  },
});
const ingestResultSchema = z.strictObject({
  runId: z.uuid(),
  state: z.enum(['staging', 'published', 'failed']),
  editionId: z.uuid().nullable().optional(),
});

function policy(sourceId: string, patch: Partial<SourcePolicy> = {}) {
  return {
    ...sourcePolicySchema.parse({
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
    }),
    viewings: true,
    ...patch,
  };
}

function home(id: string, overrides: Partial<Observation> = {}): Observation {
  return observationSchema.parse({
    sourceListingId: id,
    episodeId: 'synthetic-episode',
    sourceUrl: `${ORIGIN}/${id}`,
    title: id,
    observedAt: new Date(baseTime).toISOString(),
    publishedAt: null,
    facts: {
      propertyType: 'apartment',
      tenure: 'cooperative',
      purchase: true,
      livingAreaM2: 60,
      secondaryAreaM2: null,
      rooms: 2,
      askingPriceSek: 2_500_000,
      groundFloor: null,
      lift: null,
      liftServesHome: null,
      stepFree: null,
      outdoor: null,
      glazed: null,
      largePrivateTerrace: null,
      municipality: 'Synthetic municipality',
      baseFeeSek: null,
      mandatoryMonthlySek: null,
      status: 'available',
    },
    conflicts: [],
    coordinates: null,
    evidence: [],
    photo: null,
    ...overrides,
  });
}

const aged = (days: number) => new Date(baseTime - days * DAY).toISOString();

async function freshDatabase(through: 'before' | 'all') {
  const database = await PGlite.create();
  await database.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
  const names = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of names) {
    if (through === 'before' && name === CATALOG) break;
    await database.exec(await migration(name));
  }
  return database;
}

function migration(name: string) {
  return readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
}

// Migrations after the catalog, in order, so the suite tests the current snapshot.
async function applyAfterCatalog(database: PGlite) {
  const names = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql') && name > CATALOG)
    .sort();
  for (const name of names) await database.exec(await migration(name));
}

let db: PGlite;

async function as<T>(
  role: 'anon' | 'authenticated' | 'service_role',
  userId: string | null,
  action: () => Promise<T>,
  database = db,
) {
  await database.query("select set_config('request.jwt.claim.sub',$1,false)", [
    userId ?? '',
  ]);
  await database.exec(`set role ${role}`);
  try {
    return await action();
  } finally {
    await database.exec('reset role');
    await database.query("select set_config('request.jwt.claim.sub','',false)");
  }
}

async function rpc(
  sql: string,
  params: (string | number | boolean | null)[] = [],
  database = db,
) {
  const result = await database.query<{ value: unknown }>(sql, params);
  return result.rows[0]?.value;
}

// The snapshot as earlier databases sent it, before shared hides replaced the member's own hidden ids.
const pastSnapshotSchema = snapshotSchema.extend({
  hiddenListingIds: z.array(z.uuid()).max(1500).optional(),
});
type PastSnapshot = z.infer<typeof pastSnapshotSchema>;

// The member's snapshot as the app builds it: from the v2 snapshot where the database has it, otherwise from the
// named old function.
async function snapshot(
  household = HOUSE_A,
  user = OWNER_A,
  database = db,
  call?: 'hs_snapshot' | 'hs_snapshot_neighborhoods',
): Promise<PastSnapshot> {
  const v2 =
    !call &&
    (
      await database.query<{ found: boolean }>(
        "select to_regprocedure('public.hs_household_snapshot(uuid)') is not null as found",
      )
    ).rows[0].found;
  return as(
    'authenticated',
    user,
    async () =>
      v2
        ? expandSnapshot(
            snapshotV2Schema.parse(
              await rpc(
                'select public.hs_household_snapshot($1) as value',
                [household],
                database,
              ),
            ),
          )
        : pastSnapshotSchema.parse(
            await rpc(
              `select public.${call ?? 'hs_snapshot_neighborhoods'}($1) as value`,
              [household],
              database,
            ),
          ),
    database,
  );
}

function asUser(user: string, sql: string, params: (string | boolean)[]) {
  return as('authenticated', user, () => rpc(sql, params));
}

async function ingest(request: IngestRequest, database = db) {
  const body = JSON.stringify(ingestRequestSchema.parse(request));
  return as(
    'service_role',
    null,
    async () =>
      ingestResultSchema.parse(
        await rpc(
          'select public.hs_ingest($1,$2,$3::jsonb) as value',
          [KEY, createHash('sha256').update(body).digest('hex'), body],
          database,
        ),
      ),
    database,
  );
}

async function publish(
  observations: Observation[],
  options: {
    source?: string;
    profiles?: boolean;
    status?: 'success' | 'partial' | 'failed';
    database?: PGlite;
    // Source listing ids on the search pages, and whether the read was full.
    seen?: string[];
    fullRead?: boolean;
  } = {},
) {
  const {
    source = 'alpha',
    profiles = false,
    status = 'success',
    database = db,
    seen,
    fullRead,
  } = options;
  const runId = randomUUID();
  await ingest(
    {
      action: 'begin',
      contractVersion: 1,
      runId,
      sourceIds: [source],
      ...(profiles
        ? { profileVersions: [{ profileId: PROFILE_A, revision: 1 }] }
        : {}),
    },
    database,
  );
  await ingest(
    {
      action: 'stage',
      contractVersion: 1,
      runId,
      batchId: randomUUID(),
      sourceId: source,
      observations,
    },
    database,
  );
  return ingest(
    {
      action: 'publish',
      contractVersion: 1,
      runId,
      results: [
        {
          sourceId: source,
          status,
          coverageNote: 'Synthetic local coverage',
          cursor: `cursor-${source}`,
          ...(fullRead === undefined ? {} : { fullRead }),
          ...(seen
            ? {
                seen: seen.map((sourceListingId) => ({
                  sourceListingId,
                  episodeId: 'synthetic-episode',
                })),
              }
            : {}),
        },
      ],
    },
    database,
  );
}

// One household on the pre-catalog schema, seeded through the RPCs the app and collector use.
async function seedHouseholdA(database: PGlite) {
  for (const user of [OWNER_A, MEMBER_A])
    await database.query('insert into auth.users values($1)', [user]);
  await database.query(
    "insert into hs.households(id,name) values($1,'Synthetic household')",
    [HOUSE_A],
  );
  for (const [user, role] of [
    [OWNER_A, 'owner'],
    [MEMBER_A, 'member'],
  ])
    await database.query(
      "insert into hs.members(household_id,user_id,display_name,role) values($1,$2,'Synthetic member',$3)",
      [HOUSE_A, user, role],
    );
  await database.query(
    "insert into hs.profiles(id,household_id,name,enabled,criteria,edited_by) values($1,$2,'Synthetic profile',true,$3::jsonb,$4)",
    [PROFILE_A, HOUSE_A, JSON.stringify(criteria), OWNER_A],
  );
  for (const source of ['alpha', 'beta'])
    await database.query(
      "insert into hs.source_policies(household_id,source_id,policy,cursor) values($1,$2,$3::jsonb,'previous-cursor')",
      [HOUSE_A, source, JSON.stringify(policy(source))],
    );
  await database.query(
    "insert into hs.ingest_credentials(key_id,household_id,source_ids,expires_at) values($1,$2,array['alpha','beta'],now()+interval '1 day')",
    [KEY, HOUSE_A],
  );
  const now = new Date(baseTime).toISOString();
  await publish(
    [
      home('fresh', {
        coordinates: {
          longitude: 0,
          latitude: 0,
          precision: 'address',
          source: 'Synthetic coordinates',
          observedAt: now,
        },
        photo: {
          url: `${ORIGIN}/photo`,
          attribution: 'Synthetic image',
          rightsBasis: 'Synthetic permission',
          observedAt: now,
          expiresAt: new Date(baseTime + DAY).toISOString(),
          displayAllowed: true,
          hotlinkAllowed: true,
        },
        evidence: [
          {
            id: randomUUID(),
            kind: 'source_claim',
            subject: 'facts',
            summary: 'Synthetic evidence',
            sourceUrl: `${ORIGIN}/fresh`,
            observedAt: now,
            datasetVersion: null,
            method: null,
            value: null,
            unit: null,
          },
        ],
        viewings: [
          {
            startsAt: new Date(baseTime + 3 * DAY).toISOString(),
            endsAt: null,
          },
        ],
      }),
      home('priced', { observedAt: aged(0.5) }),
      home('hidden'),
      home('expired', { observedAt: aged(2) }),
      home('saved-expired', { observedAt: aged(2) }),
      home('noted-expired', { observedAt: aged(2) }),
    ],
    { profiles: true, database },
  );
  await publish(
    [
      home('priced', {
        facts: { ...home('priced').facts, askingPriceSek: 2_400_000 },
      }),
    ],
    { profiles: true, database },
  );
  await publish([home('other-source')], {
    source: 'beta',
    profiles: true,
    database,
  });
  const listed = await snapshot(HOUSE_A, OWNER_A, database);
  const idOf = (title: string) => {
    const found = listed.listings.find((item) => item.title === title)?.id;
    if (!found) throw new Error(`Seeded listing ${title} missing`);
    return found;
  };
  const call = (user: string, sql: string, params: (string | boolean)[]) =>
    as('authenticated', user, () => rpc(sql, params, database), database);
  const manual = z
    .object({ listingId: z.string() })
    .parse(
      await call(
        OWNER_A,
        'select public.hs_add_manual($1,$2,$3,$4,$5::jsonb) as value',
        [HOUSE_A, `${ORIGIN}/bookmark`, 'Bookmark', 'Manual note', '["tag"]'],
      ),
    ).listingId;
  const favorite = 'select public.hs_set_favorite($1,$2,$3) as value';
  await call(OWNER_A, favorite, [HOUSE_A, idOf('saved-expired'), true]);
  await call(MEMBER_A, favorite, [HOUSE_A, idOf('fresh'), true]);
  await call(MEMBER_A, favorite, [HOUSE_A, manual, true]);
  const note = 'select public.hs_save_note($1,$2,$3,0) as value';
  await call(MEMBER_A, note, [HOUSE_A, idOf('noted-expired'), 'Keep this']);
  await call(OWNER_A, note, [HOUSE_A, idOf('priced'), 'Price dropped']);
  const hide =
    'select public.hs_set_hidden($1,array[$2]::uuid[],true) as value';
  await call(OWNER_A, hide, [HOUSE_A, idOf('hidden')]);
  // Both members hide this one; the shared hides migration keeps the later hide.
  await call(MEMBER_A, hide, [HOUSE_A, idOf('hidden')]);
  await call(MEMBER_A, hide, [HOUSE_A, manual]);
  // Two homes age out of a one-day window; the saved and noted ones stay visible to this household.
  await database.query(
    "update hs.source_policies set policy=jsonb_set(policy,'{retentionDays}','1') where source_id='alpha'",
  );
  return {
    manual,
    fresh: idOf('fresh'),
    expired: idOf('expired'),
    hidden: idOf('hidden'),
  };
}

let seeded: Awaited<ReturnType<typeof seedHouseholdA>>;
let before: Record<string, unknown>;
let afterMove: Record<string, unknown>;

async function memberSnapshots() {
  const result: Record<string, unknown> = {};
  for (const user of [OWNER_A, MEMBER_A])
    for (const call of ['hs_snapshot', 'hs_snapshot_neighborhoods'] as const)
      result[`${user}:${call}`] = await snapshot(HOUSE_A, user, db, call);
  return result;
}

beforeAll(async () => {
  db = await freshDatabase('before');
  seeded = await seedHouseholdA(db);
  before = await memberSnapshots();
  await db.exec(await migration(CATALOG));
  // Later migrations change the snapshot on purpose, so the move is compared before they run.
  afterMove = await memberSnapshots();
  await applyAfterCatalog(db);
});

afterAll(async () => {
  await db?.close();
});

describe('catalog data move', () => {
  it('leaves every member snapshot of the existing household unchanged', async () => {
    expect(afterMove).toEqual(before);
    const state = before[
      `${OWNER_A}:hs_snapshot_neighborhoods`
    ] as PastSnapshot;
    // The seed exercises what the move must carry: manual, saved and noted expired homes, hides, notes, viewings.
    expect(state.listings.map((item) => item.title).sort()).toEqual([
      'Bookmark',
      'fresh',
      'hidden',
      'noted-expired',
      'other-source',
      'priced',
      'saved-expired',
    ]);
    expect(state.hiddenListingIds).toHaveLength(1);
    expect(state.notes).toHaveLength(3);
    expect(
      state.listings.find((item) => item.title === 'fresh')?.viewings,
    ).toHaveLength(1);
    expect(
      state.listings.find((item) => item.title === 'priced')
        ?.previousAskingPriceSek,
    ).toBe(2_500_000);
  });

  it('keeps ids and moves manual listings and their activity out of the catalog', async () => {
    const counts = await db.query<{
      catalog: number;
      manual: number;
      favorites: number;
      manual_favorites: number;
    }>(
      `select (select count(*)::int from hs.listings) catalog,
      (select count(*)::int from hs.manual_listings) manual,
      (select count(*)::int from hs.favorites where listing_id is not null) favorites,
      (select count(*)::int from hs.favorites where manual_listing_id=$1) manual_favorites`,
      [seeded.manual],
    );
    expect(counts.rows[0]).toEqual({
      catalog: 7,
      manual: 1,
      favorites: 2,
      manual_favorites: 1,
    });
  });

  it('refuses to move data owned by more than one household', async () => {
    const other = await freshDatabase('before');
    try {
      await seedHouseholdA(other);
      await other.query('insert into auth.users values($1)', [OWNER_B]);
      await other.query(
        "insert into hs.households(id,name) values($1,'Second household')",
        [HOUSE_B],
      );
      await other.query(
        'insert into hs.source_policies(household_id,source_id,policy) values($1,$2,$3::jsonb)',
        [HOUSE_B, 'alpha', JSON.stringify(policy('alpha'))],
      );
      await expect(other.exec(await migration(CATALOG))).rejects.toThrow(
        'Catalog move needs at most one household owning source data',
      );
    } finally {
      await other.close();
    }
  });
});

describe('catalog rollback', () => {
  it('restores the household schema, its snapshots, ingest with profile versions and the purge', async () => {
    const restored = await freshDatabase('before');
    try {
      const ids = await seedHouseholdA(restored);
      const original: Record<string, unknown> = {};
      for (const user of [OWNER_A, MEMBER_A])
        original[user] = await snapshot(HOUSE_A, user, restored);
      await restored.exec(await migration(CATALOG));
      await restored.exec(
        await readFile(
          new URL(
            '../rollbacks/20261020111540_house_scanner_catalog_down.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      for (const user of [OWNER_A, MEMBER_A])
        expect(await snapshot(HOUSE_A, user, restored)).toEqual(original[user]);
      const manual = await restored.query<{ origin: string }>(
        'select origin from hs.listings where id=$1',
        [ids.manual],
      );
      expect(manual.rows).toEqual([{ origin: 'manual' }]);
      // The restored ingest requires the household's current profile versions again.
      await publish([home('after-rollback')], {
        profiles: true,
        database: restored,
      });
      expect(
        (await snapshot(HOUSE_A, OWNER_A, restored)).listings.some(
          (item) => item.title === 'after-rollback',
        ),
      ).toBe(true);
      await expect(
        publish([home('without-profiles')], { database: restored }),
      ).rejects.toThrow('Profiles changed or incomplete');
      const purge = await as(
        'service_role',
        null,
        () =>
          rpc(
            'select public.hs_purge_expired($1,10,true) as value',
            [HOUSE_A],
            restored,
          ),
        restored,
      );
      expect(purge).toMatchObject({ more: false });
    } finally {
      await restored.close();
    }
  });

  it('refuses to roll back once a second household exists', async () => {
    const shared = await freshDatabase('all');
    try {
      for (const id of [HOUSE_A, HOUSE_B])
        await shared.query(
          "insert into hs.households(id,name) values($1,'Synthetic household')",
          [id],
        );
      await expect(
        shared.exec(
          await readFile(
            new URL(
              '../rollbacks/20261020111540_house_scanner_catalog_down.sql',
              import.meta.url,
            ),
            'utf8',
          ),
        ),
      ).rejects.toThrow('Catalog rollback needs exactly one household');
    } finally {
      await shared.close();
    }
  });
});

describe('a second household on the shared catalog', () => {
  beforeAll(async () => {
    await db.query('insert into auth.users values($1)', [OWNER_B]);
    await db.query(
      "insert into hs.households(id,name) values($1,'Second household')",
      [HOUSE_B],
    );
    await db.query(
      "insert into hs.members(household_id,user_id,display_name,role) values($1,$2,'Second owner','owner')",
      [HOUSE_B, OWNER_B],
    );
    await db.query(
      "insert into hs.profiles(id,household_id,name,enabled,criteria,edited_by) values($1,$2,'Second profile',true,$3::jsonb,$4)",
      [PROFILE_B, HOUSE_B, JSON.stringify(criteria), OWNER_B],
    );
  });

  it('sees live catalog listings without the first household activity or private rows', async () => {
    const state = await snapshot(HOUSE_B, OWNER_B);
    expect(state.listings.map((item) => item.title).sort()).toEqual([
      'fresh',
      'hidden',
      'other-source',
      'priced',
    ]);
    expect(state.listings.every((item) => item.householdId === HOUSE_B)).toBe(
      true,
    );
    expect(state.favorites).toEqual([]);
    expect(state.notes).toBeUndefined();
    expect(state.hides).toBeUndefined();
    expect(state.members.map((member) => member.userId)).toEqual([OWNER_B]);
  });

  it('keeps favorites, notes and hides inside their household', async () => {
    await asUser(
      OWNER_B,
      'select public.hs_set_favorite($1,$2,true) as value',
      [HOUSE_B, seeded.fresh],
    );
    await asUser(OWNER_B, 'select public.hs_save_note($1,$2,$3,0) as value', [
      HOUSE_B,
      seeded.fresh,
      'Second household note',
    ]);
    const b = await snapshot(HOUSE_B, OWNER_B);
    expect(b.favorites.map((item) => item.userId)).toEqual([OWNER_B]);
    expect(b.notes?.map((item) => item.body)).toEqual([
      'Second household note',
    ]);
    const a = await snapshot(HOUSE_A, MEMBER_A);
    expect(
      a.favorites.filter((item) => item.listingId === seeded.fresh),
    ).toEqual([expect.objectContaining({ userId: MEMBER_A })]);
    expect(a.notes?.some((item) => item.body === 'Second household note')).toBe(
      false,
    );
    expect(b.notes?.filter((item) => item.listingId === seeded.fresh)).toEqual([
      expect.objectContaining({ userId: OWNER_B }),
    ]);
  });

  it('cannot reach another household manual listing or an expired catalog listing', async () => {
    for (const listing of [seeded.manual, seeded.expired])
      await expect(
        asUser(OWNER_B, 'select public.hs_set_favorite($1,$2,true) as value', [
          HOUSE_B,
          listing,
        ]),
      ).rejects.toThrow('Listing unavailable');
    await expect(
      asUser(
        OWNER_B,
        'select public.hs_set_hidden($1,array[$2]::uuid[],true) as value',
        [HOUSE_B, seeded.manual],
      ),
    ).rejects.toThrow('Listing unavailable');
    await expect(
      asUser(OWNER_B, 'select public.hs_save_note($1,$2,$3,0) as value', [
        HOUSE_B,
        seeded.expired,
        'Should not save',
      ]),
    ).rejects.toThrow('Note changed; reload before saving');
  });

  it('shares hides across the household with the latest hider, and keeps them from other households', async () => {
    const hides = async (household: string, user: string) =>
      (await snapshot(household, user)).hides?.map(({ listingId, userId }) => ({
        listingId,
        userId,
      }));
    // Each member's earlier hides now apply to both; the listing both hid keeps the later hide.
    const merged = [
      { listingId: seeded.hidden, userId: MEMBER_A },
      { listingId: seeded.manual, userId: MEMBER_A },
    ].sort((a, b) => (a.listingId < b.listingId ? -1 : 1));
    expect(await hides(HOUSE_A, OWNER_A)).toEqual(merged);
    expect(await hides(HOUSE_A, MEMBER_A)).toEqual(merged);
    expect((await snapshot(HOUSE_A, OWNER_A)).hiddenListingIds).toBeUndefined();

    const setHidden = (user: string, house: string, id: string, on: boolean) =>
      asUser(
        user,
        'select public.hs_set_hidden($1,array[$2]::uuid[],$3) as value',
        [house, id, on],
      );
    // The owner hides the member's favorite: it stays saved and returned, marked with the owner.
    await setHidden(OWNER_A, HOUSE_A, seeded.fresh, true);
    const member = await snapshot(HOUSE_A, MEMBER_A);
    expect(member.listings.some((item) => item.id === seeded.fresh)).toBe(true);
    expect(
      member.favorites.some(
        (item) => item.listingId === seeded.fresh && item.userId === MEMBER_A,
      ),
    ).toBe(true);
    expect(member.hides).toContainEqual(
      expect.objectContaining({ listingId: seeded.fresh, userId: OWNER_A }),
    );
    // Another household sees none of it, and its own hide leaves this household alone.
    expect(await hides(HOUSE_B, OWNER_B)).toBeUndefined();
    await setHidden(OWNER_B, HOUSE_B, seeded.fresh, true);
    expect(await hides(HOUSE_B, OWNER_B)).toEqual([
      { listingId: seeded.fresh, userId: OWNER_B },
    ]);
    expect(await hides(HOUSE_A, OWNER_A)).toContainEqual({
      listingId: seeded.fresh,
      userId: OWNER_A,
    });
    // Hiding again records the latest member; either member unhides it for everyone.
    await setHidden(MEMBER_A, HOUSE_A, seeded.fresh, true);
    expect(await hides(HOUSE_A, OWNER_A)).toContainEqual({
      listingId: seeded.fresh,
      userId: MEMBER_A,
    });
    await setHidden(OWNER_A, HOUSE_A, seeded.fresh, false);
    expect(await hides(HOUSE_A, MEMBER_A)).toEqual(merged);
    expect(await hides(HOUSE_B, OWNER_B)).toEqual([
      { listingId: seeded.fresh, userId: OWNER_B },
    ]);
    await setHidden(OWNER_B, HOUSE_B, seeded.fresh, false);
  });

  it('adds its own manual listing for a shared URL and reuses a visible catalog listing', async () => {
    const add = (url: string) =>
      asUser(
        OWNER_B,
        'select public.hs_add_manual($1,$2,$3,$4,$5::jsonb) as value',
        [HOUSE_B, url, 'Second bookmark', '', '[]'],
      );
    const own = z
      .object({ listingId: z.string(), existing: z.boolean() })
      .parse(await add(`${ORIGIN}/bookmark`));
    expect(own.existing).toBe(false);
    expect(own.listingId).not.toBe(seeded.manual);
    expect(await add(`${ORIGIN}/fresh`)).toEqual({
      listingId: seeded.fresh,
      existing: true,
    });
    const a = await snapshot(HOUSE_A, OWNER_A);
    expect(a.listings.some((item) => item.id === own.listingId)).toBe(false);
  });
});

describe('ingest into the catalog', () => {
  it('stores one row per source listing for every household and ignores profile versions', async () => {
    await asUser(
      OWNER_A,
      'select public.hs_save_profile($1,$2,1,$3,true,$4::jsonb) as value',
      [HOUSE_A, PROFILE_A, 'Changed profile', JSON.stringify(criteria)],
    );
    // A stale revision in the request no longer matters, and neither does leaving it out.
    await publish(
      [
        home('fresh', {
          title: 'fresh renamed',
          observedAt: new Date().toISOString(),
        }),
      ],
      { profiles: true },
    );
    await publish([
      home('brand-new', { observedAt: new Date().toISOString() }),
    ]);
    const rows = await db.query<{ count: number }>(
      "select count(*)::int count from hs.listings where source_listing_id in ('fresh','brand-new')",
    );
    expect(rows.rows[0].count).toBe(2);
    for (const [household, user] of [
      [HOUSE_A, OWNER_A],
      [HOUSE_B, OWNER_B],
    ]) {
      const titles = (await snapshot(household, user)).listings.map(
        (item) => item.title,
      );
      expect(titles).toContain('fresh renamed');
      expect(titles).toContain('brand-new');
    }
    const fresh = (await snapshot(HOUSE_B, OWNER_B)).listings.find(
      (item) => item.title === 'brand-new',
    );
    expect(fresh?.isNew).toBe(true);
  });

  it('keeps the replay and conflict guards', async () => {
    const runId = randomUUID();
    const begin: IngestRequest = {
      action: 'begin',
      contractVersion: 1,
      runId,
      sourceIds: ['beta'],
    };
    expect((await ingest(begin)).state).toBe('staging');
    expect((await ingest(begin)).state).toBe('staging');
    const stage = (title: string): IngestRequest => ({
      action: 'stage',
      contractVersion: 1,
      runId,
      batchId: randomUUID(),
      sourceId: 'beta',
      observations: [home('conflict', { title })],
    });
    await ingest(stage('first'));
    await expect(ingest(stage('second'))).rejects.toThrow(
      'Conflicting same-time observation',
    );
    await expect(ingest({ ...begin, sourceIds: ['alpha'] })).rejects.toThrow(
      'Run ID reused with different content',
    );
  });

  it('publishes nothing for a failed source and keeps its listings', async () => {
    const before = (await snapshot(HOUSE_B, OWNER_B)).listings.length;
    const result = await publish([home('never-published')], {
      source: 'beta',
      status: 'failed',
    });
    expect(result.state).toBe('failed');
    expect((await snapshot(HOUSE_B, OWNER_B)).listings).toHaveLength(before);
  });

  it('returns credentials without a household and policies by source', async () => {
    const credential = await as('service_role', null, () =>
      rpc('select public.hs_ingest_credential($1) as value', [KEY]),
    );
    expect(credential).toEqual({
      sourceIds: ['alpha', 'beta'],
      scopes: ['ingest'],
    });
    const policies = z
      .array(z.object({ sourceId: z.string() }))
      .parse(
        await as('service_role', null, () =>
          rpc('select public.hs_ingest_policies($1) as value', [KEY]),
        ),
      );
    expect(policies.map((item) => item.sourceId)).toEqual(['alpha', 'beta']);
  });
});

describe('candidates filtered by household criteria', () => {
  const shared = { ...criteria, ...HARD_RULE_CRITERIA };

  it('applies the hard rules shared with the client matcher', async () => {
    for (const {
      name,
      facts,
      conflicts = [],
      sourceId = null,
      sourceIds,
      excluded,
    } of HARD_RULE_CASES) {
      const fails = await rpc(
        'select hs.fails_hard_rule($1::jsonb,$2::jsonb,$3::jsonb,$4) as value',
        [
          JSON.stringify({ ...HARD_RULE_BASE_FACTS, ...facts }),
          JSON.stringify(conflicts),
          JSON.stringify({ ...shared, sourceIds }),
          sourceId,
        ],
      );
      expect({ name, fails }).toEqual({ name, fails: excluded });
    }
  });

  it('returns a household only the listings its enabled profiles can use, plus saved and hidden ones', async () => {
    const now = new Date().toISOString();
    const candidate = (id: string, overrides: Partial<Observation['facts']>) =>
      home(id, {
        observedAt: now,
        facts: { ...home(id).facts, ...overrides },
      });
    await publish(
      [
        candidate('fits-both', { livingAreaM2: 90 }),
        candidate('too-small-for-b', { livingAreaM2: 55 }),
        candidate('saved-by-b', { livingAreaM2: 40 }),
        candidate('hidden-by-b', { livingAreaM2: 40 }),
        candidate('area-unknown', { livingAreaM2: null }),
      ],
      { source: 'beta' },
    );
    await db.query(
      'update hs.profiles set criteria=$1::jsonb where household_id=$2',
      [JSON.stringify({ ...criteria, minAreaM2: 60 }), HOUSE_B],
    );
    const idOf = async (title: string) =>
      (
        await db.query<{ id: string }>(
          "select id from hs.listings where value->>'title'=$1",
          [title],
        )
      ).rows[0].id;
    // Saved and hidden before the criteria exclude them, as a member would from the list.
    await db.query(
      "insert into hs.favorites(household_id,listing_id,user_id,bookmark_url) values($1,$2,$3,'https://example.invalid/saved-by-b')",
      [HOUSE_B, await idOf('saved-by-b'), OWNER_B],
    );
    await db.query(
      'insert into hs.hidden_listings(household_id,listing_id,user_id) values($1,$2,$3)',
      [HOUSE_B, await idOf('hidden-by-b'), OWNER_B],
    );
    const titles = async (household: string, user: string) =>
      (await snapshot(household, user)).listings.map((item) => item.title);
    const b = await titles(HOUSE_B, OWNER_B);
    expect(b).toEqual(
      expect.arrayContaining([
        'fits-both',
        'saved-by-b',
        'hidden-by-b',
        'area-unknown',
      ]),
    );
    expect(b).not.toContain('too-small-for-b');
    // Household A's 50 m² minimum keeps the 55 m² home, but not the unsaved 40 m² ones.
    const a = await titles(HOUSE_A, OWNER_A);
    expect(a).toEqual(
      expect.arrayContaining(['fits-both', 'too-small-for-b', 'area-unknown']),
    );
    expect(a).not.toContain('saved-by-b');
    expect(a).not.toContain('hidden-by-b');

    await db.query(
      'update hs.profiles set enabled=false where household_id=$1',
      [HOUSE_B],
    );
    expect(await titles(HOUSE_B, OWNER_B)).toEqual(
      expect.arrayContaining(['saved-by-b', 'hidden-by-b']),
    );
    expect(await titles(HOUSE_B, OWNER_B)).not.toContain('fits-both');
    await db.query(
      'update hs.profiles set enabled=true where household_id=$1',
      [HOUSE_B],
    );
  });

  it('keeps a household to the sources its criteria select, plus saved and hidden ones', async () => {
    const revision = async () =>
      (
        await db.query<{ revision: number }>(
          'select revision from hs.profiles where id=$1',
          [PROFILE_B],
        )
      ).rows[0].revision;
    const save = async (value: unknown) =>
      asUser(
        OWNER_B,
        'select public.hs_save_profile($1,$2,$3,$4,true,$5::jsonb) as value',
        [
          HOUSE_B,
          PROFILE_B,
          String(await revision()),
          'Second profile',
          JSON.stringify(value),
        ],
      );
    for (const sourceIds of [[], ['Not a source id'], [1], 'alpha'])
      await expect(save({ ...criteria, sourceIds })).rejects.toThrow(
        'Invalid profile',
      );
    await save({ ...criteria, sourceIds: ['alpha'] });
    const b = await snapshot(HOUSE_B, OWNER_B);
    const sources = new Set(
      b.listings
        .filter((item) => item.origin === 'source')
        .map((item) => item.sourceId),
    );
    expect(sources).toEqual(new Set(['alpha', 'beta']));
    // Only the beta listings this household saved or hid remain.
    expect(
      b.listings
        .filter((item) => item.sourceId === 'beta')
        .map((item) => item.title)
        .sort(),
    ).toEqual(['hidden-by-b', 'saved-by-b']);
    expect(
      (await snapshot(HOUSE_A, OWNER_A)).listings.some(
        (item) => item.sourceId === 'beta' && item.title === 'fits-both',
      ),
    ).toBe(true);
    // Manual listings carry no source.
    expect(
      (await snapshot(HOUSE_A, OWNER_A)).listings.find(
        (item) => item.origin === 'manual',
      )?.sourceId,
    ).toBeUndefined();
    await save({ ...criteria, minAreaM2: 60 });
    expect(
      (await snapshot(HOUSE_B, OWNER_B)).listings.map((item) => item.title),
    ).toContain('fits-both');
  });

  it('rolls back delisting, shared hides and the criteria filter, and applies them again', async () => {
    const delisted = '20261020142553_house_scanner_delisted';
    const shared = '20261020133201_house_scanner_shared_hides';
    const filter = '20261020121634_house_scanner_criteria_filter';
    const down = async (name: string) =>
      db.exec(
        await readFile(
          new URL(`../rollbacks/${name}_down.sql`, import.meta.url),
          'utf8',
        ),
      );
    const titles = async () =>
      (await snapshot(HOUSE_B, OWNER_B)).listings.map((item) => item.title);
    await db.query(
      `update hs.profiles set criteria=criteria||'{"sourceIds":["alpha","beta"]}' where id=$1`,
      [PROFILE_B],
    );
    await db.query(
      "update hs.listings set delisted_at=now(),missed_full_reads=2 where value->>'title'='fits-both'",
    );
    // Rollbacks go newest first: the household rows call the hard rules these migrations replace.
    await db.exec(await rollback(DROP_OLD));
    await db.exec(await rollback(SNAPSHOT_V2));
    await db.exec(await rollback(HOUSEHOLDS));
    await down(delisted);
    expect(
      (await snapshot(HOUSE_A, OWNER_A)).listings.some(
        (item) => item.delistedAt !== undefined,
      ),
    ).toBe(false);
    expect(await titles()).toContain('fits-both');
    await down(shared);
    // Merged hides go back to the member who hid them last; source selections are dropped.
    const member = await snapshot(HOUSE_A, MEMBER_A);
    expect(member.hides).toBeUndefined();
    expect(member.hiddenListingIds).toEqual(
      [seeded.hidden, seeded.manual].sort(),
    );
    expect(member.listings.every((item) => item.sourceId === undefined)).toBe(
      true,
    );
    expect((await snapshot(HOUSE_A, OWNER_A)).hiddenListingIds).toBeUndefined();
    expect(
      (await snapshot(HOUSE_B, OWNER_B)).profiles[0].criteria.sourceIds,
    ).toBeUndefined();
    expect(await titles()).not.toContain('too-small-for-b');
    await down(filter);
    expect(await titles()).toContain('too-small-for-b');
    await db.exec(await migration(`${filter}.sql`));
    await db.exec(await migration(`${shared}.sql`));
    await db.exec(await migration(`${delisted}.sql`));
    await db.exec(await migration(`${HOUSEHOLDS}.sql`));
    await db.exec(await migration(`${SNAPSHOT_V2}.sql`));
    await db.exec(await migration(`${DROP_OLD}.sql`));
    expect(await titles()).not.toContain('too-small-for-b');
    expect((await snapshot(HOUSE_A, OWNER_A)).hides).toHaveLength(2);
  });

  it('serves the same snapshots with the set-based snapshot and after rolling it back', async () => {
    const speed = '20261021194535_house_scanner_snapshot_speed';
    const both = async () => [
      await snapshot(HOUSE_A, OWNER_A, db, 'hs_snapshot_neighborhoods'),
      await snapshot(HOUSE_B, OWNER_B, db, 'hs_snapshot_neighborhoods'),
    ];
    await db.exec(await rollback(DROP_OLD));
    await db.exec(await migration(`${speed}.sql`));
    const fast = await both();
    expect(fast[0].listings.length).toBeGreaterThan(0);
    // Without a search path the planner can inline the rule into the snapshot query.
    const configs = await db.query<{ proconfig: string[] | null }>(
      "select proconfig from pg_proc where proname='fails_hard_rule'",
    );
    expect(configs.rows.map((row) => row.proconfig)).toEqual([null, null]);
    await db.exec(
      await readFile(
        new URL(`../rollbacks/${speed}_down.sql`, import.meta.url),
        'utf8',
      ),
    );
    expect(await both()).toEqual(fast);
    await db.exec(await migration(`${speed}.sql`));
    expect(await both()).toEqual(fast);
    await db.exec(await migration(`${DROP_OLD}.sql`));
  });

  // The delisting rollback above re-applied the row-by-row trigger; applying the set-based publish and the listing
  // history again puts the current ones back for the delisting tests below.
  it('rolls back the listing history and set-based publish, publishes with the old functions, and applies them again', async () => {
    const setBased = '20261021201851_house_scanner_set_based_publish';
    const history = '20261022065048_house_scanner_listing_history';
    const down = async (name: string) =>
      db.exec(
        await readFile(
          new URL(`../rollbacks/${name}_down.sql`, import.meta.url),
          'utf8',
        ),
      );
    await down(history);
    await down(setBased);
    await publish(
      [home('after-rollback', { observedAt: new Date().toISOString() })],
      { source: 'beta' },
    );
    await db.exec(await migration(`${setBased}.sql`));
    // Full copies for the backfill: a price drop and a sale, each followed by a cosmetic edit.
    const now = () => new Date().toISOString();
    const facts = home('x').facts;
    await publish(
      [
        home('history-price', { observedAt: now() }),
        home('history-sold', { observedAt: now() }),
      ],
      { source: 'beta' },
    );
    for (const renamed of [false, true])
      await publish(
        [
          home('history-price', {
            observedAt: now(),
            facts: { ...facts, askingPriceSek: 2_400_000 },
            ...(renamed ? { title: 'price renamed' } : {}),
          }),
          home('history-sold', {
            observedAt: now(),
            facts: { ...facts, status: 'sold' },
            ...(renamed ? { title: 'sold renamed' } : {}),
          }),
        ],
        { source: 'beta' },
      );
    const snapshots = async () => [
      await snapshot(HOUSE_A, OWNER_A),
      await snapshot(HOUSE_B, OWNER_B),
    ];
    const before = await snapshots();
    await db.exec(await migration(`${history}.sql`));
    const after = await snapshots();
    const withoutChangeDates = (state: z.infer<typeof snapshotSchema>) => ({
      ...state,
      listings: state.listings.map(
        ({ lastChangedAt: _lastChangedAt, ...rest }) => rest,
      ),
    });
    expect(after.map(withoutChangeDates)).toEqual(
      before.map(withoutChangeDates),
    );
    const changeDate = (states: typeof before, title: string) =>
      states[1].listings.find((item) => item.title === title)?.lastChangedAt;
    expect(changeDate(before, 'price renamed')).toEqual(expect.any(String));
    expect(changeDate(after, 'price renamed')).not.toEqual(
      changeDate(before, 'price renamed'),
    );
    expect(changeDate(after, 'brand-new')).toEqual(
      changeDate(before, 'brand-new'),
    );
    // The backfill matches the tracked differences between consecutive copies, worked out here from the copies.
    const copies = await db.query<{
      listing_id: string;
      run_id: string;
      value: Observation;
    }>(
      'select listing_id,run_id,value from hs.observations order by listing_id,received_at,id',
    );
    const expected = copies.rows.flatMap((row, index) => {
      const prior = copies.rows[index - 1];
      if (prior?.listing_id !== row.listing_id) return [];
      return (['askingPriceSek', 'status'] as const)
        .filter((field) => prior.value.facts[field] !== row.value.facts[field])
        .map((field) => ({
          listing_id: row.listing_id,
          run_id: row.run_id,
          observed_at: new Date(row.value.observedAt),
          field,
          old_value: prior.value.facts[field],
          new_value: row.value.facts[field],
        }));
    });
    const backfilled = await db.query(
      'select listing_id,run_id,observed_at,field,old_value,new_value from hs.listing_changes order by id',
    );
    expect(expected.length).toBeGreaterThanOrEqual(2);
    expect(backfilled.rows).toEqual(expected);
    const rows = await db.query<{ closed: number; unhashed: number }>(
      `select (select count(*)::int from hs.staged_observations o join hs.runs r on r.id=o.run_id where r.state<>'staging') closed,
        (select count(*)::int from hs.listings where content_hash is null) unhashed`,
    );
    expect(rows.rows[0]).toEqual({ closed: 0, unhashed: 0 });
    const published = await db.query<{ revision: number }>(
      "select revision from hs.listings where source_listing_id='after-rollback'",
    );
    expect(published.rows).toEqual([{ revision: 1 }]);
  });
});

describe('listings that leave their source', () => {
  const now = () => new Date().toISOString();
  const state = async (title: string) =>
    (
      await db.query<{ missed: number; delisted: boolean }>(
        "select missed_full_reads missed, delisted_at is not null delisted from hs.listings where value->>'title'=$1",
        [title],
      )
    ).rows[0];
  const betaIds = async (except: string[]) =>
    (
      await db.query<{ id: string }>(
        "select source_listing_id id from hs.listings where source_id='beta' and not (value->>'title' = any($1))",
        [except],
      )
    ).rows.map((row) => row.id);
  // A run that stages one home and reports the rest of the source as seen, or not.
  const read = async (missing: string[], fullRead?: boolean) =>
    publish([home('fits-both', { observedAt: now() })], {
      source: 'beta',
      seen: await betaIds(missing),
      fullRead,
    });

  it('marks a home missing from two full reads, and nothing for partial reads', async () => {
    await read(['gone-a', 'gone-b'], true);
    await publish(
      [
        home('gone-a', { observedAt: now() }),
        home('gone-b', { observedAt: now() }),
      ],
      { source: 'beta' },
    );
    expect(await state('gone-a')).toEqual({ missed: 0, delisted: false });
    await read(['gone-a', 'saved-by-b'], true);
    expect(await state('gone-a')).toEqual({ missed: 1, delisted: false });
    // A read that is not full marks nothing, and a home seen outside the bounds is not missing.
    await read(['gone-a', 'saved-by-b']);
    await read(['gone-a', 'saved-by-b'], false);
    expect(await state('gone-a')).toEqual({ missed: 1, delisted: false });
    expect(await state('too-small-for-b')).toEqual({
      missed: 0,
      delisted: false,
    });
    await read(['gone-a', 'saved-by-b'], true);
    expect(await state('gone-a')).toEqual({ missed: 2, delisted: true });
    expect(await state('saved-by-b')).toEqual({ missed: 2, delisted: true });
    expect(await state('gone-b')).toEqual({ missed: 0, delisted: false });
  });

  it('leaves browsing, keeps saved homes with the date, and unmarks a home seen again', async () => {
    const b = await snapshot(HOUSE_B, OWNER_B);
    expect(b.listings.some((item) => item.title === 'gone-a')).toBe(false);
    const saved = b.listings.find((item) => item.title === 'saved-by-b');
    expect(saved?.delistedAt).toEqual(expect.any(String));
    expect(
      b.listings.find((item) => item.title === 'gone-b')?.delistedAt,
    ).toBeUndefined();
    await read(['saved-by-b']);
    expect(await state('gone-a')).toEqual({ missed: 0, delisted: false });
    expect(
      (await snapshot(HOUSE_B, OWNER_B)).listings.some(
        (item) => item.title === 'gone-a',
      ),
    ).toBe(true);
    // A home the run staged counts as seen even without a seen list.
    await publish([home('saved-by-b', { observedAt: now() })], {
      source: 'beta',
    });
    expect(await state('saved-by-b')).toEqual({ missed: 0, delisted: false });
  });

  it('ignores the marks of a failed source result', async () => {
    await read(['gone-b'], true);
    await expect(
      publish([home('gone-b', { observedAt: now() })], {
        source: 'beta',
        status: 'failed',
        seen: [],
        fullRead: true,
      }),
    ).resolves.toMatchObject({ state: 'failed' });
    expect(await state('gone-b')).toEqual({ missed: 1, delisted: false });
  });
});

describe('set-based publish', () => {
  const SET_BASED_DOWN = new URL(
    '../rollbacks/20261021201851_house_scanner_set_based_publish_down.sql',
    import.meta.url,
  );
  const HISTORY_DOWN = new URL(
    '../rollbacks/20261022065048_house_scanner_listing_history_down.sql',
    import.meta.url,
  );
  const at = (hours: number) => new Date(baseTime + hours * HOUR).toISOString();
  const place = (longitude: number, observedAt: string) => ({
    longitude,
    latitude: 0,
    precision: 'address' as const,
    source: 'Synthetic coordinates',
    observedAt,
  });
  const priced = (id: string, askingPriceSek: number, observedAt: string) =>
    home(id, { observedAt, facts: { ...home(id).facts, askingPriceSek } });

  // One source and credential on the current schema, or with the listing history and set-based publish rolled back.
  async function catalog(publish: 'rowByRow' | 'setBased' | 'current') {
    const database = await freshDatabase('all');
    if (publish !== 'current')
      await database.exec(await readFile(HISTORY_DOWN, 'utf8'));
    if (publish === 'rowByRow')
      await database.exec(await readFile(SET_BASED_DOWN, 'utf8'));
    await database.query(
      'insert into hs.source_policies(source_id,policy) values($1,$2::jsonb)',
      ['alpha', JSON.stringify(policy('alpha'))],
    );
    await database.query(
      "insert into hs.ingest_credentials(key_id,source_ids,expires_at) values($1,array['alpha'],now()+interval '1 day')",
      [KEY],
    );
    return database;
  }

  // Everything publish decides, without generated ids and the database clock.
  async function catalogState(database: PGlite) {
    const listings = await database.query<Record<string, unknown>>(
      `select l.source_listing_id,l.value,l.observed_at,l.revision,l.previous_asking_price,l.previous_price_observed_at,
        l.missed_full_reads,l.delisted_at is not null delisted,l.first_seen_run_id is not null discovered,
        (select coalesce(jsonb_agg(o.value order by o.received_at,o.value::text),'[]'::jsonb) from hs.observations o where o.listing_id=l.id) history
       from hs.listings l order by l.source_listing_id`,
    );
    const runs = await database.query(
      `select r.state,r.results,(select e.coverage from hs.editions e where e.run_id=r.id) coverage
       from hs.runs r order by r.created_at,r.id`,
    );
    return { listings: listings.rows, runs: runs.rows };
  }

  it('publishes the same catalog as the row-by-row publish it replaces', async () => {
    const seen = ['steady', 'cheaper', 'conflicted', 'moving'];
    // Discovery, an unchanged refresh, a price drop, a conflicted price, a moved home, two full reads that delist
    // one home, a failed result, and a partial read that brings it back.
    const steps = [
      (database: PGlite) =>
        publish(
          [
            home('steady', { observedAt: at(0), coordinates: place(0, at(0)) }),
            priced('cheaper', 2_500_000, at(0)),
            home('gone', { observedAt: at(0) }),
            home('conflicted', { observedAt: at(0) }),
          ],
          { database },
        ),
      (database: PGlite) =>
        publish(
          [
            home('steady', { observedAt: at(1), coordinates: place(0, at(1)) }),
            priced('cheaper', 2_300_000, at(1)),
            home('conflicted', {
              observedAt: at(1),
              conflicts: ['askingPriceSek'],
            }),
            home('moving', { observedAt: at(1), coordinates: place(1, at(1)) }),
          ],
          { database, seen, fullRead: true },
        ),
      (database: PGlite) =>
        publish(
          [home('moving', { observedAt: at(2), coordinates: place(2, at(2)) })],
          { database, seen, fullRead: true },
        ),
      (database: PGlite) =>
        publish([home('never', { observedAt: at(3) })], {
          database,
          status: 'failed',
        }),
      (database: PGlite) =>
        publish([priced('cheaper', 2_300_000, at(4))], {
          database,
          status: 'partial',
          seen: ['gone'],
        }),
    ];
    const results = [];
    for (const mode of ['rowByRow', 'setBased'] as const) {
      const database = await catalog(mode);
      try {
        const states = [];
        for (const step of steps) {
          await step(database);
          states.push(await catalogState(database));
        }
        results.push(states);
      } finally {
        await database.close();
      }
    }
    expect(results[1]).toEqual(results[0]);
    // The scenario reaches the cases it names.
    const [, , delisting, , last] = results[1];
    const row = (state: typeof last, id: string) =>
      state.listings.find((item) => item.source_listing_id === id);
    expect(row(delisting, 'gone')).toMatchObject({ delisted: true });
    expect(row(last, 'gone')).toMatchObject({ delisted: false });
    expect(row(last, 'cheaper')).toMatchObject({
      previous_asking_price: 2_500_000,
      revision: 2,
    });
    expect(row(last, 'steady')).toMatchObject({ revision: 1 });
    expect(row(last, 'moving')).toMatchObject({ revision: 2 });
    expect(row(last, 'never')).toBeUndefined();
  });

  it('refreshes an unchanged home without a change row and looks up the neighborhood only when it moves', async () => {
    const database = await catalog('current');
    try {
      await database.exec(`create table hs.lookups(listing text);
        create or replace function hs.assign_neighborhood() returns trigger language plpgsql set search_path=pg_catalog,hs as $$
        begin
         insert into hs.lookups values(new.source_listing_id);
         new.neighborhood_id:=hs.neighborhood_for_coordinates(new.value->'coordinates');
         return new;
        end; $$;`);
      const lookups = async () =>
        (
          await database.query<{ listing: string }>(
            'delete from hs.lookups returning listing',
          )
        ).rows.map((item) => item.listing);
      const viewing = (hours: number) => [
        { startsAt: at(hours), endsAt: null },
      ];
      const stored = async () =>
        (
          await database.query<{
            revision: number;
            changes: number;
            observed: string;
            viewing: string;
          }>(
            `select revision,(select count(*)::int from hs.listing_changes c where c.listing_id=l.id) changes,
              value->>'observedAt' observed,value->'viewings'->0->>'startsAt' viewing
             from hs.listings l where source_listing_id='steady'`,
          )
        ).rows[0];
      await publish(
        [
          home('steady', {
            observedAt: at(0),
            coordinates: place(0, at(0)),
            viewings: viewing(48),
          }),
        ],
        { database },
      );
      expect(await lookups()).toEqual(['steady']);
      await publish(
        [
          home('steady', {
            observedAt: at(1),
            coordinates: place(0, at(1)),
            viewings: viewing(72),
          }),
        ],
        { database },
      );
      expect(await lookups()).toEqual([]);
      expect(await stored()).toEqual({
        revision: 1,
        changes: 0,
        observed: at(1),
        viewing: at(72),
      });
      await publish(
        [home('steady', { observedAt: at(2), coordinates: place(1, at(2)) })],
        { database },
      );
      expect(await lookups()).toEqual(['steady']);
      // A move is not a tracked change.
      expect(await stored()).toMatchObject({ revision: 1, changes: 0 });
    } finally {
      await database.close();
    }
  });

  it('keeps staged rows only until their run closes, and closes runs abandoned for a day', async () => {
    const database = await catalog('current');
    try {
      const staged = async () =>
        (
          await database.query<{ count: number }>(
            'select count(*)::int count from hs.staged_observations',
          )
        ).rows[0].count;
      await publish([home('published', { observedAt: at(0) })], { database });
      expect(await staged()).toBe(0);
      const runId = randomUUID();
      await ingest(
        { action: 'begin', contractVersion: 1, runId, sourceIds: ['alpha'] },
        database,
      );
      await ingest(
        {
          action: 'stage',
          contractVersion: 1,
          runId,
          batchId: randomUUID(),
          sourceId: 'alpha',
          observations: [home('abandoned', { observedAt: at(1) })],
        },
        database,
      );
      expect(await staged()).toBe(1);
      await database.query(
        "update hs.runs set created_at=now()-interval '25 hours' where id=$1",
        [runId],
      );
      await ingest(
        {
          action: 'begin',
          contractVersion: 1,
          runId: randomUUID(),
          sourceIds: ['alpha'],
        },
        database,
      );
      expect(await staged()).toBe(0);
      const left = await database.query<{ state: string; listed: boolean }>(
        "select state,exists(select 1 from hs.listings where source_listing_id='abandoned') listed from hs.runs where id=$1",
        [runId],
      );
      expect(left.rows).toEqual([{ state: 'failed', listed: false }]);
    } finally {
      await database.close();
    }
  });

  it('refuses a different observation for the listing time, ignores an older one, and refuses a home staged twice', async () => {
    const database = await catalog('current');
    try {
      await publish([home('fixed', { observedAt: at(0) })], { database });
      await publish([home('fixed', { observedAt: at(1) })], { database });
      await expect(
        publish([home('fixed', { observedAt: at(1), title: 'changed' })], {
          database,
        }),
      ).rejects.toThrow('Conflicting same-time observation across runs');
      // Without full copies there is no history to compare an older time with; publish skips it as before.
      await publish([home('fixed', { observedAt: at(0), title: 'other' })], {
        database,
      });
      const kept = await database.query<{ title: string }>(
        "select value->>'title' title from hs.listings where source_listing_id='fixed'",
      );
      expect(kept.rows).toEqual([{ title: 'fixed' }]);
      await expect(
        publish(
          [
            home('twice', { observedAt: at(2) }),
            home('twice', { observedAt: at(3) }),
          ],
          { database },
        ),
      ).rejects.toThrow('Listing staged more than once in run');
    } finally {
      await database.close();
    }
  });

  it('records asking price, status and delisting changes, and otherwise publishes as the set-based publish did', async () => {
    const seen = ['steady', 'cheaper', 'selling', 'touched'];
    const sold = home('selling', {
      observedAt: at(1),
      facts: { ...home('selling').facts, status: 'sold' },
    });
    const photo = {
      url: `${ORIGIN}/photo`,
      attribution: 'Synthetic image',
      rightsBasis: 'Synthetic permission',
      observedAt: at(2),
      expiresAt: at(26),
      displayAllowed: true,
      hotlinkAllowed: true,
    } as const;
    // Discovery, a price drop, a sale, a renamed and moved home, a new photo, two full reads that delist one home,
    // and a partial read that brings it back.
    const steps = [
      (database: PGlite) =>
        publish(
          [
            home('steady', { observedAt: at(0) }),
            priced('cheaper', 2_500_000, at(0)),
            home('selling', { observedAt: at(0) }),
            home('touched', { observedAt: at(0) }),
            home('gone', { observedAt: at(0) }),
          ],
          { database },
        ),
      (database: PGlite) =>
        publish(
          [
            home('steady', { observedAt: at(1) }),
            priced('cheaper', 2_300_000, at(1)),
            sold,
            home('touched', {
              observedAt: at(1),
              title: 'touched renamed',
              coordinates: place(1, at(1)),
            }),
          ],
          { database, seen, fullRead: true },
        ),
      (database: PGlite) =>
        publish(
          [
            home('touched', {
              observedAt: at(2),
              title: 'touched renamed',
              coordinates: place(1, at(1)),
              photo,
            }),
          ],
          { database, seen, fullRead: true },
        ),
      (database: PGlite) =>
        publish([priced('cheaper', 2_300_000, at(3))], {
          database,
          status: 'partial',
          seen: ['gone'],
        }),
    ];
    const results: Record<string, Awaited<ReturnType<typeof catalogState>>[]> =
      {};
    let changes: Record<string, unknown>[] = [];
    let listings: Record<string, unknown>[] = [];
    for (const mode of ['setBased', 'current'] as const) {
      const database = await catalog(mode);
      try {
        results[mode] = [];
        for (const step of steps) {
          await step(database);
          results[mode].push(await catalogState(database));
        }
        if (mode === 'current') {
          changes = (
            await database.query<Record<string, unknown>>(
              `select l.source_listing_id,c.field,c.old_value,c.new_value from hs.listing_changes c
               join hs.listings l on l.id=c.listing_id order by c.observed_at,l.source_listing_id`,
            )
          ).rows;
          listings = (
            await database.query<Record<string, unknown>>(
              `select source_listing_id,first_seen_run_id=(select id from hs.runs order by created_at limit 1) first_run,
                last_changed_at>first_seen_at changed,(select count(*)::int from hs.observations o where o.listing_id=l.id) copies
               from hs.listings l order by source_listing_id`,
            )
          ).rows;
        }
      } finally {
        await database.close();
      }
    }
    // Only the revision and history differ; the change rows replace the history.
    const strip = (state: Awaited<ReturnType<typeof catalogState>>) => ({
      ...state,
      listings: state.listings.map(
        ({ revision: _revision, history: _history, ...rest }) => rest,
      ),
    });
    expect(results.current.map(strip)).toEqual(results.setBased.map(strip));
    const revisions = (mode: string) =>
      Object.fromEntries(
        results[mode][3].listings.map((row) => [
          row.source_listing_id,
          row.revision,
        ]),
      );
    expect(revisions('setBased')).toEqual({
      cheaper: 2,
      gone: 1,
      selling: 2,
      steady: 1,
      touched: 3,
    });
    expect(revisions('current')).toEqual({
      cheaper: 2,
      gone: 1,
      selling: 2,
      steady: 1,
      touched: 1,
    });
    expect(
      results.current[3].listings.find(
        (row) => row.source_listing_id === 'touched',
      )?.value,
    ).toMatchObject({ title: 'touched renamed', photo: { url: photo.url } });
    expect(changes).toEqual([
      {
        source_listing_id: 'cheaper',
        field: 'askingPriceSek',
        old_value: 2_500_000,
        new_value: 2_300_000,
      },
      {
        source_listing_id: 'selling',
        field: 'status',
        old_value: 'available',
        new_value: 'sold',
      },
      {
        source_listing_id: 'gone',
        field: 'delisted',
        old_value: null,
        new_value: null,
      },
      {
        source_listing_id: 'gone',
        field: 'relisted',
        old_value: null,
        new_value: null,
      },
    ]);
    // Every home is discovered by the first run without a full copy; only tracked changes move the change date.
    expect(listings).toEqual(
      ['cheaper', 'gone', 'selling', 'steady', 'touched'].map((id) => ({
        source_listing_id: id,
        first_run: true,
        changed: id === 'cheaper' || id === 'selling',
        copies: 0,
      })),
    );
  });
});

// Data foundation migrations (spec: house-scanner-data-foundation).
const WRITE_PATH = '20261022102043_house_scanner_write_path';
const CARDS = '20261022103309_house_scanner_listing_cards';
const HOUSEHOLDS = '20261022105133_house_scanner_household_listings';
const SNAPSHOT_V2 = '20261022113745_house_scanner_household_snapshot';
const HOUSEHOLD_START = '20261022124605_house_scanner_household_start';
const rollback = (name: string) =>
  readFile(new URL(`../rollbacks/${name}_down.sql`, import.meta.url), 'utf8');

// The member's v2 snapshot, expanded by the client adapter, equals the old snapshot. Returns the v2 response. On a
// database that has dropped the old snapshot, its rollback restores it for the comparison and the drop runs again after.
async function sameAsV2(database: PGlite, household: string, user: string) {
  const dropped = (
    await database.query<{ gone: boolean }>(
      "select to_regprocedure('public.hs_snapshot_neighborhoods(uuid)') is null as gone",
    )
  ).rows[0].gone;
  if (dropped) await database.exec(await rollback(DROP_OLD));
  try {
    return await compareWithOld(database, household, user);
  } finally {
    if (dropped) await database.exec(await migration(`${DROP_OLD}.sql`));
  }
}
async function compareWithOld(
  database: PGlite,
  household: string,
  user: string,
) {
  const [today, v2] = await as(
    'authenticated',
    user,
    async () => [
      await rpc(
        'select public.hs_snapshot_neighborhoods($1) as value',
        [household],
        database,
      ),
      await rpc(
        'select public.hs_household_snapshot($1) as value',
        [household],
        database,
      ),
    ],
    database,
  );
  const parsed = snapshotV2Schema.parse(v2);
  expect(expandSnapshot(parsed)).toEqual(snapshotSchema.parse(today));
  return parsed;
}

// A database with the migrations up to and including the named one.
async function migratedThrough(last: string) {
  const database = await PGlite.create();
  await database.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
  for (const name of (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql') && name <= `${last}.sql`)
    .sort())
    await database.exec(await migration(name));
  return database;
}

// Functions with their grants, tables, indexes, columns, triggers and storage options of hs, as text. Function texts
// ignore carriage returns: a Windows checkout gives the migration files CRLF line endings.
async function fingerprint(database: PGlite) {
  const result = await database.query<{ line: string }>(`
    select 'fn '||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||') '||md5(replace(pg_get_functiondef(p.oid),chr(13),''))
      ||' anon='||has_function_privilege('anon',p.oid,'execute')||' auth='||has_function_privilege('authenticated',p.oid,'execute')
      ||' svc='||has_function_privilege('service_role',p.oid,'execute') line
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('hs','public')
    union all select 'relation '||c.relkind::text||' '||c.relname||' rls='||c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='hs' and c.relkind in ('r','S')
    union all select 'index '||indexdef from pg_indexes where schemaname='hs'
    union all select 'column '||table_name||'.'||column_name||' '||data_type from information_schema.columns where table_schema='hs'
    union all select 'trigger '||pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='hs' and not t.tgisinternal
    union all select 'options '||c.relname||' '||coalesce(array_to_string(c.reloptions,','),'') from pg_class c
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='hs' and c.relkind='r'
    order by line`);
  return result.rows.map((row) => row.line);
}

// A fresh database on every migration with the given sources and a credential for them.
async function sources(...ids: string[]) {
  return sourcesOn(await freshDatabase('all'), ids);
}
async function sourcesOn(database: PGlite, ids: string[]) {
  for (const id of ids)
    await database.query(
      'insert into hs.source_policies(source_id,policy) values($1,$2::jsonb)',
      [id, JSON.stringify(policy(id))],
    );
  await database.query(
    "insert into hs.ingest_credentials(key_id,source_ids,expires_at) values($1,$2,now()+interval '1 day')",
    [KEY, ids],
  );
  return database;
}

describe('write-path fixes', () => {
  const WRITE_PATH_DOWN = new URL(
    `../rollbacks/${WRITE_PATH}_down.sql`,
    import.meta.url,
  );
  const now = () => new Date().toISOString();
  // The rule the snapshot used before each source recorded its latest run.
  const OLD_LATEST = `select distinct on (result->>'sourceId') result->>'sourceId' source_id,r.id
    from hs.editions e join hs.runs r on r.id=e.run_id, lateral jsonb_array_elements(r.results) result
    where r.state='published' and result->>'status' in ('success','partial')
    order by result->>'sourceId',e.published_at desc,e.id desc`;

  it('rolls back to exactly the earlier schema and applies again', async () => {
    const earlier = await migratedThrough(WRITE_PATH);
    try {
      await earlier.exec(await readFile(WRITE_PATH_DOWN, 'utf8'));
      const rolledBack = await fingerprint(earlier);
      const plain = await migratedThrough(
        '20261022065048_house_scanner_listing_history',
      );
      try {
        expect(rolledBack).toEqual(await fingerprint(plain));
      } finally {
        await plain.close();
      }
      await earlier.exec(await migration(`${WRITE_PATH}.sql`));
      const migrated = await fingerprint(earlier);
      expect(migrated).not.toEqual(rolledBack);
      expect(migrated).toContain('options listings fillfactor=70');
      expect(
        migrated.filter((line) => line.startsWith('fn hs.record_latest_run')),
      ).toEqual([expect.stringMatching(/anon=false auth=false svc=false$/)]);
    } finally {
      await earlier.close();
    }
  });

  it('serves the same snapshots with each source’s latest run as with the scan of every run', async () => {
    // The old snapshot, which reads each source's latest run on both sides of the rollback.
    const both = async () => [
      await snapshot(HOUSE_A, OWNER_A, db, 'hs_snapshot_neighborhoods'),
      await snapshot(HOUSE_B, OWNER_B, db, 'hs_snapshot_neighborhoods'),
    ];
    await db.exec(await rollback(DROP_OLD));
    await db.exec(await readFile(WRITE_PATH_DOWN, 'utf8'));
    const scanned = await both();
    await db.exec(await migration(`${WRITE_PATH}.sql`));
    expect(await both()).toEqual(scanned);
    await db.exec(await migration(`${DROP_OLD}.sql`));
    expect(
      scanned.flatMap((state) => state.listings).some((item) => item.isNew),
    ).toBe(true);
    const latest = await db.query(
      `select p.source_id,p.latest_run_id id from hs.source_policies p
       where p.latest_run_id is not null order by 1`,
    );
    expect(latest.rows.length).toBeGreaterThan(0);
    expect(latest.rows).toEqual(
      (await db.query(`select * from (${OLD_LATEST}) x order by 1`)).rows,
    );
  });

  it('records the latest run of each source that succeeded or was partial, as the scan found it', async () => {
    const database = await sources('alpha', 'beta');
    try {
      const steps: Parameters<typeof publish>[] = [
        [[home('a1', { observedAt: now() })], { source: 'alpha', database }],
        [[home('b1', { observedAt: now() })], { source: 'beta', database }],
        [[home('a2', { observedAt: now() })], { source: 'alpha', database }],
        [
          [home('a3', { observedAt: now() })],
          { source: 'alpha', status: 'failed', database },
        ],
        [
          [home('b1', { observedAt: now() })],
          { source: 'beta', status: 'partial', database },
        ],
      ];
      for (const step of steps) {
        await publish(...step);
        const recorded = await database.query(
          'select source_id,latest_run_id id from hs.source_policies where latest_run_id is not null order by 1',
        );
        expect(recorded.rows).toEqual(
          (await database.query(`select * from (${OLD_LATEST}) x order by 1`))
            .rows,
        );
      }
      const fresh = await database.query<{ id: string; fresh: boolean }>(
        `select l.source_listing_id id,l.first_seen_run_id=p.latest_run_id fresh
         from hs.listings l join hs.source_policies p on p.source_id=l.source_id order by 1`,
      );
      expect(fresh.rows).toEqual([
        { id: 'a1', fresh: false },
        { id: 'a2', fresh: true },
        { id: 'b1', fresh: false },
      ]);
    } finally {
      await database.close();
    }
  });

  it('leaves a delisted home untouched on later full reads until a run sees it again', async () => {
    const database = await sources('alpha');
    try {
      const read = (seen: string[]) =>
        publish([home('kept', { observedAt: now() })], {
          database,
          seen,
          fullRead: true,
        });
      const gone = async () =>
        (
          await database.query<{
            version: string;
            missed: number;
            delisted: boolean;
            changes: string[];
          }>(
            `select l.xmin::text version,l.missed_full_reads missed,l.delisted_at is not null delisted,
              array(select field from hs.listing_changes c where c.listing_id=l.id order by c.id) changes
             from hs.listings l where source_listing_id='gone'`,
          )
        ).rows[0];
      await publish(
        [
          home('kept', { observedAt: now() }),
          home('gone', { observedAt: now() }),
        ],
        { database },
      );
      await read(['kept']);
      await read(['kept']);
      const delisted = await gone();
      expect(delisted).toMatchObject({
        missed: 2,
        delisted: true,
        changes: ['delisted'],
      });
      await read(['kept']);
      await read(['kept']);
      expect(await gone()).toEqual(delisted);
      await read(['kept', 'gone']);
      expect(await gone()).toMatchObject({
        missed: 0,
        delisted: false,
        changes: ['delisted', 'relisted'],
      });
    } finally {
      await database.close();
    }
  });
});

describe('listing cards', () => {
  const now = () => new Date().toISOString();
  const hours = (count: number) =>
    new Date(Date.now() + count * HOUR).toISOString();
  // A card as today's snapshot sends the home to household $1, with the clock-dependent rules applied at read time.
  const AS_SNAPSHOT = `
    select jsonb_build_object(
      'id',c.listing_id,'householdId',$1::uuid,'origin','source','sourceId',c.source_id,'title',c.title,
      'sourceUrls',jsonb_build_array(c.source_url),'facts',c.facts,'conflicts',c.conflicts,'coordinates',shown.coordinates,
      'evidence',coalesce((select jsonb_agg(e order by n) from jsonb_array_elements(c.evidence) with ordinality x(e,n)
        where (e->>'observedAt')::timestamptz>=now()-c.retention),'[]'::jsonb),
      'photo',case when hs.policy_current(p.policy) and (c.photo->>'expiresAt')::timestamptz>now()
        and (c.photo->>'observedAt')::timestamptz>=now()-c.retention then c.photo else 'null'::jsonb end,
      'previousAskingPriceSek',case when c.previous_price_observed_at>=now()-c.retention then c.previous_asking_price end,
      'observedAt',c.observed_at,'addedBy',null,'userTags','[]'::jsonb,
      'firstSeenAt',c.first_seen_at,'lastChangedAt',c.last_changed_at,'lastCheckedAt',c.last_checked_at,
      'isNew',coalesce(c.first_seen_run_id=p.latest_run_id,false))
     ||case when c.delisted_at is null then '{}'::jsonb else jsonb_build_object('delistedAt',c.delisted_at) end
     ||coalesce((select jsonb_build_object('viewings',jsonb_agg(x order by x->>'startsAt')) from jsonb_array_elements(c.viewings) x
        where hs.policy_current(p.policy) and (x->>'startsAt')::timestamptz>now() having count(*)>0),'{}'::jsonb)
     ||case when n.id is not null and jsonb_typeof(shown.coordinates)='object' then jsonb_build_object('neighborhood',
        jsonb_build_object('id',n.id,'name',n.name,'method','polygon','datasetVersion',n.dataset_version)) else '{}'::jsonb end
     ||case when jsonb_typeof(shown.coordinates)='object' then jsonb_build_object('neighborhoodCandidates',
        coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'method','polygon','datasetVersion',a.dataset_version) order by ids.position)
         from unnest(c.neighborhood_candidates) with ordinality ids(id,position) join hs.neighborhoods a on a.id=ids.id),'[]'::jsonb))
        ||case when c.neighborhood_radius_m is null then '{}'::jsonb else jsonb_build_object('neighborhoodRadiusM',c.neighborhood_radius_m) end
       else '{}'::jsonb end item
    from hs.listing_cards c join hs.source_policies p on p.source_id=c.source_id
    left join hs.neighborhoods n on n.id=c.neighborhood_id
    cross join lateral (select case when (c.coordinates->>'observedAt')::timestamptz>=now()-c.retention
      and (c.coordinates->>'observedAt')::timestamptz<=now()+interval '5 minutes' then c.coordinates else 'null'::jsonb end coordinates) shown
    where c.listing_id=any($2::uuid[])`;
  const byId = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => a.id.localeCompare(b.id));

  // Every source home in the household's snapshot equals its card, and every card equals a fresh computation.
  async function matches(database: PGlite, household: string, user: string) {
    const homes = (await snapshot(household, user, database)).listings.filter(
      (item) => item.origin === 'source',
    );
    const cards = await database.query<{ item: { id: string } }>(AS_SNAPSHOT, [
      household,
      homes.map((item) => item.id),
    ]);
    expect(byId(cards.rows.map((row) => row.item))).toEqual(byId(homes));
    const drift = await database.query('select * from hs.card_drift()');
    expect(drift.rows).toEqual([]);
    await sameAsV2(database, household, user);
    return homes;
  }

  it('rolls back to exactly the earlier schema and applies again', async () => {
    const database = await migratedThrough(CARDS);
    try {
      const migrated = await fingerprint(database);
      await database.exec(await rollback(CARDS));
      const earlier = await migratedThrough(WRITE_PATH);
      try {
        expect(await fingerprint(database)).toEqual(await fingerprint(earlier));
      } finally {
        await earlier.close();
      }
      await database.exec(await migration(`${CARDS}.sql`));
      expect(await fingerprint(database)).toEqual(migrated);
      expect(
        migrated.filter(
          (line) => line.startsWith('fn hs.') && /card/.test(line),
        ),
      ).toEqual(
        Array(5).fill(
          expect.stringMatching(/anon=false auth=false svc=false$/),
        ),
      );
      expect(migrated).toContain('relation r listing_cards rls=true');
    } finally {
      await database.close();
    }
  });

  it('matches what the snapshot sends for every home of both households on the shared database', async () => {
    const a = await matches(db, HOUSE_A, OWNER_A);
    const b = await matches(db, HOUSE_B, OWNER_B);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    const counts = await db.query<{ cards: number; listings: number }>(
      'select (select count(*)::int from hs.listing_cards) cards,(select count(*)::int from hs.listings) listings',
    );
    expect(counts.rows[0].cards).toBe(counts.rows[0].listings);
  });

  it('follows publishes, delisting, direct edits, the clock and policy changes', async () => {
    const database = await sources('alpha');
    try {
      await database.query('insert into auth.users values($1)', [OWNER_A]);
      await database.query(
        "insert into hs.households(id,name) values($1,'Synthetic household')",
        [HOUSE_A],
      );
      await database.query(
        "insert into hs.members(household_id,user_id,display_name,role) values($1,$2,'Synthetic owner','owner')",
        [HOUSE_A, OWNER_A],
      );
      await database.query(
        "insert into hs.profiles(id,household_id,name,enabled,criteria,edited_by) values($1,$2,'Synthetic profile',true,$3::jsonb,$4)",
        [PROFILE_A, HOUSE_A, JSON.stringify(criteria), OWNER_A],
      );
      const check = () => matches(database, HOUSE_A, OWNER_A);
      const evidence = (subject: 'facts' | 'nearby_nature', id: string) => ({
        id,
        kind: 'source_claim' as const,
        subject,
        summary: 'Synthetic claim',
        sourceUrl: `${ORIGIN}/claim`,
        observedAt: now(),
        datasetVersion: null,
        method: null,
        value: null,
        unit: null,
      });
      const pictured = (observedAt: string) =>
        home('pictured', {
          observedAt,
          coordinates: {
            longitude: 11.95,
            latitude: 57.7,
            precision: 'address',
            source: 'Synthetic',
            observedAt,
          },
          photo: {
            url: `${ORIGIN}/photo.jpg`,
            attribution: 'Synthetic image',
            rightsBasis: 'Synthetic permission',
            observedAt,
            expiresAt: hours(24),
            displayAllowed: true,
            hotlinkAllowed: true,
          },
          evidence: [
            evidence('facts', '40000000-0000-4000-8000-000000000001'),
            evidence('nearby_nature', '40000000-0000-4000-8000-000000000002'),
          ],
        });
      const facts = home('x').facts;
      const all = ['plain', 'pictured', 'viewings', 'cheaper', 'conflicted'];
      await publish(
        [
          home('plain', { observedAt: now() }),
          pictured(now()),
          home('viewings', {
            observedAt: now(),
            viewings: [
              { startsAt: hours(72), endsAt: null },
              { startsAt: hours(-2), endsAt: null },
              { startsAt: hours(48), endsAt: hours(49) },
            ],
          }),
          home('cheaper', { observedAt: now() }),
          home('conflicted', { observedAt: now() }),
          home('gone', { observedAt: now() }),
        ],
        { database },
      );
      await check();
      for (const price of [2_300_000, 2_200_000])
        await publish(
          [
            home('cheaper', {
              observedAt: now(),
              facts: { ...facts, askingPriceSek: price },
            }),
            home('conflicted', {
              observedAt: now(),
              facts: { ...facts, askingPriceSek: price },
              conflicts: ['askingPriceSek'],
            }),
          ],
          { database, seen: all, fullRead: true },
        );
      await database.query(
        "insert into hs.favorites(household_id,listing_id,user_id,bookmark_url) select $1,id,$2,value->>'sourceUrl' from hs.listings where source_listing_id='gone'",
        [HOUSE_A, OWNER_A],
      );
      const published = await check();
      const item = (id: string, homes = published) =>
        homes.find((entry) => entry.title === id);
      // The scenario reaches what the card must carry.
      expect(item('gone')?.delistedAt).toEqual(expect.any(String));
      expect(item('cheaper')?.previousAskingPriceSek).toBe(2_300_000);
      expect(item('conflicted')?.previousAskingPriceSek).toBeNull();
      // The past viewing is left out and the rest come in order.
      const starts = item('viewings')?.viewings?.map((v) => v.startsAt) ?? [];
      expect(starts).toHaveLength(2);
      expect(starts[0] < starts[1]).toBe(true);
      expect(item('pictured')?.photo).not.toBeNull();
      expect(item('pictured')?.evidence).toHaveLength(2);
      // Time passes for the photo, the position and one claim; the card keeps them and the read leaves them out.
      await database.query(
        `update hs.listings set value=jsonb_set(jsonb_set(jsonb_set(value,'{photo,expiresAt}',to_jsonb($1::text)),
          '{coordinates,observedAt}',to_jsonb($2::text)),'{evidence,0,observedAt}',to_jsonb($2::text)) where source_listing_id='pictured'`,
        [hours(-1), aged(40)],
      );
      const aged40 = await check();
      expect(item('pictured', aged40)?.photo).toBeNull();
      expect(item('pictured', aged40)?.coordinates).toBeNull();
      expect(item('pictured', aged40)?.evidence).toHaveLength(1);
      // A narrower policy rewrites its source's cards without any listing write.
      await database.query(
        `update hs.source_policies set policy=policy||jsonb_build_object('allowedFactFields',
          (select jsonb_agg(f) from jsonb_array_elements(policy->'allowedFactFields') f where f #>> '{}' not in ('askingPriceSek','rooms')),
          'imageDisplay',false,'viewings',false,'allowedEvidenceSubjects','["nearby_nature"]'::jsonb,'retentionDays',10)`,
      );
      const narrowed = await check();
      expect(item('cheaper', narrowed)?.facts.askingPriceSek).toBeNull();
      expect(item('cheaper', narrowed)?.previousAskingPriceSek).toBeNull();
      expect(item('viewings', narrowed)?.viewings).toBeUndefined();
      const card = await database.query<{
        photo: unknown;
        evidence: unknown[];
      }>(
        "select c.photo,c.evidence from hs.listing_cards c join hs.listings l on l.id=c.listing_id where l.source_listing_id='pictured'",
      );
      expect(card.rows[0].photo).toBeNull();
      expect(card.rows[0].evidence).toEqual([
        expect.objectContaining({ subject: 'nearby_nature' }),
      ]);
      // A lapsed review leaves only the saved home.
      await database.query(
        `update hs.source_policies set policy=jsonb_set(policy,'{reviewDueAt}',to_jsonb($1::text))`,
        [hours(-1)],
      );
      expect((await check()).map((entry) => entry.title)).toEqual(['gone']);
    } finally {
      await database.close();
    }
  });

  it('keeps an unchanged card and its stamp, and stamps a changed one', async () => {
    const database = await sources('alpha', 'beta');
    try {
      await publish([home('quiet', { observedAt: now() })], {
        source: 'beta',
        database,
      });
      await publish([home('busy', { observedAt: now() })], { database });
      const stamps = async () =>
        Object.fromEntries(
          (
            await database.query<{ id: string; seq: string }>(
              'select l.source_listing_id id,c.changed_seq::text seq from hs.listing_cards c join hs.listings l on l.id=c.listing_id',
            )
          ).rows.map((row) => [row.id, row.seq]),
        );
      const before = await stamps();
      // A write the card does not show, and another source's publish, which also records its latest run.
      await database.query(
        "update hs.listings set missed_full_reads=1 where source_listing_id='quiet'",
      );
      await publish([home('busy', { observedAt: now() })], { database });
      const after = await stamps();
      expect(after.quiet).toBe(before.quiet);
      expect(BigInt(after.busy)).toBeGreaterThan(BigInt(before.busy));
    } finally {
      await database.close();
    }
  });
});

describe('household rows', () => {
  const now = () => new Date().toISOString();

  // The read model's homes for the household equal the snapshot's source homes, and the rows equal a fresh computation.
  // Returns the titles the household sees, sorted.
  async function sees(database: PGlite, household: string, user: string) {
    const homes = (await snapshot(household, user, database)).listings.filter(
      (item) => item.origin === 'source',
    );
    const visible = await database.query<{ listing_id: string }>(
      'select listing_id from hs.visible_listings($1)',
      [household],
    );
    expect(visible.rows.map((row) => row.listing_id).sort()).toEqual(
      homes.map((item) => item.id).sort(),
    );
    const drift = await database.query('select * from hs.household_drift()');
    expect(drift.rows).toEqual([]);
    await sameAsV2(database, household, user);
    return homes.map((item) => item.title).sort();
  }

  it('rolls back to exactly the earlier schema and applies again', async () => {
    const database = await migratedThrough(HOUSEHOLDS);
    try {
      const migrated = await fingerprint(database);
      await database.exec(await rollback(HOUSEHOLDS));
      const earlier = await migratedThrough(CARDS);
      try {
        expect(await fingerprint(database)).toEqual(await fingerprint(earlier));
      } finally {
        await earlier.close();
      }
      await database.exec(await migration(`${HOUSEHOLDS}.sql`));
      expect(await fingerprint(database)).toEqual(migrated);
      expect(migrated).toContain('relation r household_listings rls=true');
      expect(
        migrated.filter((line) =>
          /^fn hs\.(refresh_household|visible_listings|household_|card_households|profile_households|expire_household)/.test(
            line,
          ),
        ),
      ).toEqual(
        Array(8).fill(
          expect.stringMatching(/anon=false auth=false svc=false$/),
        ),
      );
    } finally {
      await database.close();
    }
  });

  it('sees what the snapshot shows for both households on the shared database', async () => {
    expect((await sees(db, HOUSE_A, OWNER_A)).length).toBeGreaterThan(0);
    expect((await sees(db, HOUSE_B, OWNER_B)).length).toBeGreaterThan(0);
  });

  it('follows profiles, favorites, notes, hides, publishes, delisting, the clock and policy changes', async () => {
    const database = await sources('alpha');
    try {
      for (const [house, owner, profile, rules] of [
        [HOUSE_A, OWNER_A, PROFILE_A, criteria],
        [HOUSE_B, OWNER_B, PROFILE_B, { ...criteria, minRooms: 3 }],
      ] as const) {
        await database.query('insert into auth.users values($1)', [owner]);
        await database.query(
          "insert into hs.households(id,name) values($1,'Synthetic household')",
          [house],
        );
        await database.query(
          "insert into hs.members(household_id,user_id,display_name,role) values($1,$2,'Synthetic owner','owner')",
          [house, owner],
        );
        await database.query(
          "insert into hs.profiles(id,household_id,name,enabled,criteria,edited_by) values($1,$2,'Synthetic profile',true,$3::jsonb,$4)",
          [profile, house, JSON.stringify(rules), owner],
        );
      }
      const a = () => sees(database, HOUSE_A, OWNER_A);
      const b = () => sees(database, HOUSE_B, OWNER_B);
      const act = (sql: string, params: (string | boolean | number)[]) =>
        as(
          'authenticated',
          OWNER_A,
          () => rpc(sql, params, database),
          database,
        );
      const facts = home('x').facts;
      const idOf = async (title: string) =>
        (
          await database.query<{ id: string }>(
            'select id from hs.listings where source_listing_id=$1',
            [title],
          )
        ).rows[0].id;
      const all = ['fits', 'roomy', 'small', 'pricey'];
      await publish(
        [
          home('fits', { observedAt: now() }),
          home('roomy', { observedAt: now(), facts: { ...facts, rooms: 3 } }),
          home('small', {
            observedAt: now(),
            facts: { ...facts, livingAreaM2: 30 },
          }),
          home('pricey', {
            observedAt: now(),
            facts: { ...facts, askingPriceSek: 3_500_000 },
          }),
        ],
        { database },
      );
      expect(await a()).toEqual(['fits', 'roomy']);
      expect(await b()).toEqual(['roomy']);
      // A save, a note with text, a blank note and a hide.
      await act('select public.hs_set_favorite($1,$2,true) as value', [
        HOUSE_A,
        await idOf('pricey'),
      ]);
      await act('select public.hs_save_note($1,$2,$3,0) as value', [
        HOUSE_A,
        await idOf('small'),
        '   ',
      ]);
      expect(await a()).toEqual(['fits', 'pricey', 'roomy']);
      await act('select public.hs_save_note($1,$2,$3,1) as value', [
        HOUSE_A,
        await idOf('small'),
        'Worth a look',
      ]);
      await act(
        'select public.hs_set_hidden($1,array[$2]::uuid[],true) as value',
        [HOUSE_A, await idOf('fits')],
      );
      expect(await a()).toEqual(['fits', 'pricey', 'roomy', 'small']);
      expect(await b()).toEqual(['roomy']);
      await act('select public.hs_set_favorite($1,$2,false) as value', [
        HOUSE_A,
        await idOf('pricey'),
      ]);
      await act(
        'select public.hs_set_hidden($1,array[$2]::uuid[],false) as value',
        [HOUSE_A, await idOf('fits')],
      );
      expect(await a()).toEqual(['fits', 'roomy', 'small']);
      // Profile saves: wider rules, then switched off, then on again.
      const saveProfile = async (enabled: boolean, rules: Criteria) => {
        const revision = (
          await database.query<{ revision: number }>(
            'select revision from hs.profiles where id=$1',
            [PROFILE_A],
          )
        ).rows[0].revision;
        await act(
          'select public.hs_save_profile($1,$2,$3,$4,$5,$6::jsonb) as value',
          [
            HOUSE_A,
            PROFILE_A,
            revision,
            'Synthetic profile',
            enabled,
            JSON.stringify(rules),
          ],
        );
      };
      await saveProfile(true, {
        ...criteria,
        minAreaM2: 20,
        stretchPriceSek: 4_000_000,
      });
      expect(await a()).toEqual(['fits', 'pricey', 'roomy', 'small']);
      await saveProfile(false, criteria);
      expect(await a()).toEqual(['small']);
      await saveProfile(true, criteria);
      expect(await a()).toEqual(['fits', 'roomy', 'small']);
      // A price rise drops a home from both households; two full reads delist another.
      await publish(
        [
          home('fits', {
            observedAt: now(),
            facts: { ...facts, askingPriceSek: 3_200_000 },
          }),
        ],
        { database, seen: all, fullRead: true },
      );
      expect(await a()).toEqual(['roomy', 'small']);
      for (let read = 0; read < 2; read += 1)
        await publish(
          [home('fits', { observedAt: now(), facts: { ...facts } })],
          {
            database,
            seen: ['fits', 'small', 'pricey'],
            fullRead: true,
          },
        );
      expect(await a()).toEqual(['fits', 'small']);
      expect(await b()).toEqual([]);
      // Time passes for a matching home: it leaves the household, and its source's next publish removes the row,
      // which nobody saved, noted or hid.
      await database.query(
        "update hs.listings set observed_at=now()-interval '40 days' where source_listing_id='fits'",
      );
      expect(await a()).toEqual(['small']);
      const fits = await idOf('fits');
      const rows = async () =>
        (
          await database.query<{ count: number }>(
            'select count(*)::int count from hs.household_listings where listing_id=$1',
            [fits],
          )
        ).rows[0].count;
      expect(await rows()).toBe(1);
      await publish(
        [
          home('small', {
            observedAt: now(),
            facts: { ...facts, livingAreaM2: 30 },
          }),
        ],
        { database },
      );
      expect(await rows()).toBe(0);
      expect(await a()).toEqual(['small']);
      // A policy that no longer lists the origin leaves only the noted home.
      await database.query(
        `update hs.source_policies set policy=jsonb_set(policy,'{listingOrigins}','["https://elsewhere.invalid"]')`,
      );
      expect(await a()).toEqual(['small']);
      expect(await b()).toEqual([]);
    } finally {
      await database.close();
    }
  });
});

describe('household snapshot v2', () => {
  const now = () => new Date().toISOString();

  // A fresh database with one source, household A and its owner, and the owner's profile.
  // Before the old snapshot was dropped, so the v2 snapshot can be compared with it.
  async function household() {
    const database = await sourcesOn(await migratedThrough(HOUSEHOLD_START), [
      'alpha',
    ]);
    await database.query('insert into auth.users values($1)', [OWNER_A]);
    await database.query(
      "insert into hs.households(id,name) values($1,'Synthetic household')",
      [HOUSE_A],
    );
    await database.query(
      "insert into hs.members(household_id,user_id,display_name,role) values($1,$2,'Synthetic owner','owner')",
      [HOUSE_A, OWNER_A],
    );
    await database.query(
      "insert into hs.profiles(id,household_id,name,enabled,criteria,edited_by) values($1,$2,'Synthetic profile',true,$3::jsonb,$4)",
      [PROFILE_A, HOUSE_A, JSON.stringify(criteria), OWNER_A],
    );
    return database;
  }

  it('rolls back to exactly the earlier schema and applies again', async () => {
    const database = await migratedThrough(SNAPSHOT_V2);
    try {
      const migrated = await fingerprint(database);
      await database.exec(await rollback(SNAPSHOT_V2));
      const earlier = await migratedThrough(HOUSEHOLDS);
      try {
        expect(await fingerprint(database)).toEqual(await fingerprint(earlier));
      } finally {
        await earlier.close();
      }
      await database.exec(await migration(`${SNAPSHOT_V2}.sql`));
      expect(await fingerprint(database)).toEqual(migrated);
      const grants = (name: string) =>
        migrated.filter((line) => line.startsWith(`fn ${name}(`));
      for (const name of [
        'public.hs_household_snapshot',
        'public.hs_set_favorites',
      ])
        expect(grants(name)).toEqual([
          expect.stringMatching(/anon=false auth=true svc=false$/),
        ]);
      expect(grants('hs.visible_listings')).toEqual([
        expect.stringMatching(/anon=false auth=false svc=false$/),
      ]);
    } finally {
      await database.close();
    }
  });

  it('expands to today’s snapshot for every member of both households on the shared database', async () => {
    const members = [
      [HOUSE_A, OWNER_A],
      [HOUSE_A, MEMBER_A],
      [HOUSE_B, OWNER_B],
    ];
    const parsed = [];
    for (const [house, user] of members) {
      const v2 = await sameAsV2(db, house, user);
      expect(v2.listings.length).toBeGreaterThan(0);
      parsed.push(v2);
    }
    // Dropping the old snapshot again left the v2 snapshot as it was.
    for (const [index, [house, user]] of members.entries())
      expect(
        snapshotV2Schema.parse(
          await as('authenticated', user, () =>
            rpc('select public.hs_household_snapshot($1) as value', [house]),
          ),
        ),
      ).toEqual(parsed[index]);
    // The shared household reaches manual homes, hides and notes.
    const a = parsed[0];
    expect(a.listings.some((home) => home.origin === 'manual')).toBe(true);
    expect(a.hides.length).toBeGreaterThan(0);
    expect(a.notes.length).toBeGreaterThan(0);
  });

  it('refuses people outside the household and anonymous callers', async () => {
    await expect(
      as('authenticated', OWNER_B, () =>
        rpc('select public.hs_household_snapshot($1) as value', [HOUSE_A]),
      ),
    ).rejects.toThrow('Household access denied');
    await expect(
      as('anon', null, () =>
        rpc('select public.hs_household_snapshot($1) as value', [HOUSE_A]),
      ),
    ).rejects.toThrow('permission denied');
    await expect(
      as('anon', null, () =>
        rpc('select public.hs_set_favorites($1,$2::uuid[],true) as value', [
          HOUSE_A,
          `{${randomUUID()}}`,
        ]),
      ),
    ).rejects.toThrow('permission denied');
  });

  it('saves and removes favorites in one call with the single-favorite rules', async () => {
    const database = await household();
    try {
      await publish(
        ['one', 'two', 'three'].map((id) => home(id, { observedAt: now() })),
        { database },
      );
      const ids = Object.fromEntries(
        (
          await database.query<{ id: string; key: string }>(
            'select id,source_listing_id key from hs.listings',
          )
        ).rows.map((row) => [row.key, row.id]),
      );
      const save = (listings: string[], saved: boolean) =>
        as(
          'authenticated',
          OWNER_A,
          () =>
            rpc(
              'select public.hs_set_favorites($1,$2::uuid[],$3) as value',
              [HOUSE_A, `{${listings.join(',')}}`, saved],
              database,
            ),
          database,
        );
      const saved = async () =>
        (
          await database.query<{ key: string }>(
            'select l.source_listing_id key from hs.favorites f join hs.listings l on l.id=f.listing_id order by 1',
          )
        ).rows.map((row) => row.key);
      await expect(save([ids.one, ids.two, ids.one], true)).resolves.toEqual({
        ok: true,
      });
      expect(await saved()).toEqual(['one', 'two']);
      // One listing the household cannot see refuses the whole call.
      await expect(save([ids.three, randomUUID()], true)).rejects.toThrow(
        'Listing unavailable',
      );
      expect(await saved()).toEqual(['one', 'two']);
      await expect(save([], true)).rejects.toThrow('Invalid favorite request');
      await expect(
        save(
          Array.from({ length: 501 }, () => ids.three),
          true,
        ),
      ).rejects.toThrow('Invalid favorite request');
      await save([ids.one], false);
      expect(await saved()).toEqual(['two']);
      const v2 = await sameAsV2(database, HOUSE_A, OWNER_A);
      expect(v2.favorites.map((favorite) => favorite.listingId)).toEqual([
        ids.two,
      ]);
      const drift = await database.query('select * from hs.household_drift()');
      expect(drift.rows).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it('costs in proportion to the household’s homes, not the size of the catalog', async () => {
    const database = await household();
    try {
      await publish(
        Array.from({ length: 40 }, (_, index) =>
          home(`fits-${index}`, { observedAt: now() }),
        ),
        { database },
      );
      // Median milliseconds of five calls of each snapshot.
      const timings = () =>
        as(
          'authenticated',
          OWNER_A,
          async () => {
            const median = async (call: string) => {
              const runs: number[] = [];
              for (let run = 0; run < 5; run += 1) {
                const started = performance.now();
                await rpc(
                  `select public.${call}($1) as value`,
                  [HOUSE_A],
                  database,
                );
                runs.push(performance.now() - started);
              }
              return runs.sort((a, b) => a - b)[2];
            };
            return {
              today: await median('hs_snapshot_neighborhoods'),
              v2: await median('hs_household_snapshot'),
            };
          },
          database,
        );
      await database.exec('analyze');
      const small = await timings();
      // 20,000 homes too small for every profile, which nobody saved, noted or hid.
      await database.query(
        `insert into hs.listings(source_id,source_listing_id,episode_id,value)
         select 'alpha','bulk-'||g,'synthetic-episode',jsonb_build_object('sourceListingId','bulk-'||g,'episodeId','synthetic-episode',
          'sourceUrl',$1||'/bulk-'||g,'title','bulk-'||g,'observedAt',now(),'publishedAt',null,'facts',$2::jsonb,
          'conflicts','[]'::jsonb,'coordinates',null,'evidence','[]'::jsonb,'photo',null)
         from generate_series(1,20000) g`,
        [ORIGIN, JSON.stringify({ ...home('x').facts, livingAreaM2: 10 })],
      );
      await database.exec('analyze');
      const large = await timings();
      const v2 = await sameAsV2(database, HOUSE_A, OWNER_A);
      expect(v2.listings).toHaveLength(40);
      expect(large.v2).toBeLessThan(small.v2 * 1.2 + 5);
      expect(large.today).toBeGreaterThan(small.today * 3);
    } finally {
      await database.close();
    }
  }, 300_000);
});

describe('household start', () => {
  const START = '20261022124605_house_scanner_household_start';
  const start = (user: string | null, household?: string) =>
    as(user ? 'authenticated' : 'anon', user, () =>
      household
        ? rpc('select public.hs_household_start($1) as value', [household])
        : rpc('select public.hs_household_start() as value'),
    );

  it('rolls back to exactly the earlier schema and applies again', async () => {
    const database = await migratedThrough(START);
    try {
      const migrated = await fingerprint(database);
      await database.exec(await rollback(START));
      const earlier = await migratedThrough(SNAPSHOT_V2);
      try {
        expect(await fingerprint(database)).toEqual(await fingerprint(earlier));
      } finally {
        await earlier.close();
      }
      await database.exec(await migration(`${START}.sql`));
      expect(await fingerprint(database)).toEqual(migrated);
      expect(
        migrated.filter((line) =>
          line.startsWith('fn public.hs_household_start('),
        ),
      ).toEqual([expect.stringMatching(/anon=false auth=true svc=false$/)]);
    } finally {
      await database.close();
    }
  });

  it('returns the memberships and the only household’s snapshot in one call', async () => {
    const [own, v2] = await as('authenticated', OWNER_A, async () => [
      await rpc('select public.hs_memberships() as value'),
      await rpc('select public.hs_household_snapshot($1) as value', [HOUSE_A]),
    ]);
    expect(await start(OWNER_A)).toEqual({ memberships: own, snapshot: v2 });
    expect(await start(OWNER_A, HOUSE_A)).toEqual({
      memberships: own,
      snapshot: v2,
    });
  });

  it('waits for a choice when the caller has several households, and reads the one named', async () => {
    const other = randomUUID();
    await db.exec('begin');
    try {
      await db.query(
        "insert into hs.households(id,name) values($1,'Visited household')",
        [other],
      );
      await db.query(
        "insert into hs.members(household_id,user_id,display_name,role) values($1,$2,'Visiting member','member')",
        [other, OWNER_A],
      );
      const none = (await start(OWNER_A)) as { memberships: unknown[] };
      expect(none).toMatchObject({ snapshot: null });
      expect(none.memberships).toHaveLength(2);
      expect(await start(OWNER_A, other)).toMatchObject({
        snapshot: { householdId: other },
      });
    } finally {
      await db.exec('rollback');
    }
  });

  it('sends no snapshot of a household the caller does not belong to', async () => {
    expect(await start(OWNER_B, HOUSE_A)).toMatchObject({ snapshot: null });
    await expect(start(null)).rejects.toThrow('permission denied');
  });
});

describe('old snapshot removal', () => {
  const OLD = [
    'fn hs.snapshot_base(',
    'fn hs.with_viewings(',
    'fn public.hs_notes(',
    'fn public.hs_snapshot(',
    'fn public.hs_snapshot_neighborhoods(',
  ];
  const old = (lines: string[]) =>
    lines.filter((line) => OLD.some((name) => line.startsWith(name)));

  it('rolls back to exactly the earlier schema and applies again', async () => {
    const database = await migratedThrough(DROP_OLD);
    try {
      const migrated = await fingerprint(database);
      expect(old(migrated)).toEqual([]);
      await database.exec(await rollback(DROP_OLD));
      const earlier = await migratedThrough(HOUSEHOLD_START);
      try {
        const restored = await fingerprint(database);
        expect(restored).toEqual(await fingerprint(earlier));
        expect(old(restored)).toHaveLength(OLD.length);
      } finally {
        await earlier.close();
      }
      await database.exec(await migration(`${DROP_OLD}.sql`));
      expect(await fingerprint(database)).toEqual(migrated);
    } finally {
      await database.close();
    }
  });

  it('answers a load with the household start alone', async () => {
    const reply = (await as('authenticated', OWNER_A, () =>
      rpc('select public.hs_household_start() as value'),
    )) as { snapshot: unknown };
    expect(snapshotV2Schema.parse(reply.snapshot).householdId).toBe(HOUSE_A);
    for (const call of [
      'select public.hs_snapshot($1) as value',
      'select public.hs_snapshot_neighborhoods($1) as value',
    ])
      await expect(
        as('authenticated', OWNER_A, () => rpc(call, [HOUSE_A])),
      ).rejects.toThrow('does not exist');
  });
});

describe('catalog administration and grants', () => {
  it('sets source policies and issues and revokes credentials without a household', async () => {
    const created = await rpc(
      'select hs.admin_set_source_policy($1::jsonb) as value',
      [JSON.stringify(policy('gamma'))],
    );
    expect(created).toMatchObject({ sourceId: 'gamma', created: true });
    await expect(
      rpc('select hs.admin_set_source_policy($1::jsonb) as value', [
        JSON.stringify(policy('gamma')),
      ]),
    ).rejects.toThrow('Policy revision must increase');
    await rpc(
      "select hs.admin_issue_credential('gamma-1',array['gamma'],now()+interval '1 day') as value",
    );
    await rpc("select hs.admin_revoke_credential('gamma-1') as value");
    const log = await db.query<{ action: string; household_id: string | null }>(
      "select action,household_id from hs.admin_log where action in ('set_source_policy','issue_credential','revoke_credential') order by id",
    );
    expect(log.rows).toEqual([
      { action: 'set_source_policy', household_id: null },
      { action: 'issue_credential', household_id: null },
      { action: 'revoke_credential', household_id: null },
    ]);
  });

  it('keeps every table private and drops the household purge', async () => {
    const tables = await db.query<{ relname: string; open: boolean }>(`
      select c.relname, not c.relrowsecurity
        or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') open
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='hs' and c.relkind='r'`);
    expect(tables.rows.filter((row) => row.open)).toEqual([]);
    expect(tables.rows.map((row) => row.relname)).toContain('manual_listings');
    const purge = await db.query(
      "select 1 from pg_proc where proname in ('purge_expired','hs_purge_expired')",
    );
    expect(purge.rows).toEqual([]);
    await expect(
      as('authenticated', OWNER_A, () =>
        rpc("select public.hs_ingest_credential('synthetic-key-a') as value"),
      ),
    ).rejects.toThrow('permission denied');
    await expect(
      as('anon', null, () => rpc('select public.hs_memberships() as value')),
    ).rejects.toThrow('permission denied');
  });
});

// Checks kept from the suites that tested the schema before the shared catalog. Each guards behaviour that still runs.
describe('carried-over guards', () => {
  const REMOVE = Symbol('remove');
  const dbAccepts = async (body: unknown) =>
    (await rpc('select hs.valid_policy($1::jsonb) as value', [
      JSON.stringify(body),
    ])) as boolean;
  // A URL refinement in the schema can throw rather than fail, which still means rejected.
  const schemaAccepts = (body: unknown) => {
    try {
      return sourcePolicySchema.safeParse(JSON.parse(JSON.stringify(body)))
        .success;
    } catch {
      return false;
    }
  };

  it('validates a source policy exactly as the shared schema does', async () => {
    const base = policy('alpha');
    expect(await dbAccepts(base)).toBe(true);
    const paths = [
      ...Object.keys(base).map((key) => [key]),
      ...Object.keys(base.capabilities).map((key) => ['capabilities', key]),
      ['extra'],
      ['capabilities', 'extra'],
    ];
    for (const path of paths)
      for (const next of [REMOVE, null, 'text', 42, -1, true, [], {}]) {
        const [key, inner] = path;
        const candidate: Record<string, unknown> = structuredClone(base);
        const target = (inner ? candidate[key] : candidate) as Record<
          string,
          unknown
        >;
        const field = inner ?? key;
        if (next === REMOVE) delete target[field];
        else target[field] = next;
        expect({
          path,
          next: String(next),
          db: await dbAccepts(candidate),
        }).toEqual({
          path,
          next: String(next),
          db: schemaAccepts(candidate),
        });
      }
  });

  it('uses each ingest one-time code once, within five minutes, and forgets it after an hour', async () => {
    const consume = (
      nonce: string,
      timestamp = Math.floor(Date.now() / 1000),
    ) =>
      as('service_role', null, () =>
        rpc('select public.hs_consume_nonce($1,$2,$3) as value', [
          KEY,
          nonce,
          timestamp,
        ]),
      );
    await db.query(
      "insert into hs.ingest_nonces(key_id,nonce,used_at) values($1,'synthetic_nonce_old',now()-interval '2 hours')",
      [KEY],
    );
    expect(await consume('synthetic_nonce_0001')).toEqual({ ok: true });
    await expect(consume('synthetic_nonce_0001')).rejects.toMatchObject({
      code: '23505',
    });
    for (const skew of [-301, 301])
      await expect(
        consume('synthetic_nonce_0002', Math.floor(Date.now() / 1000) + skew),
      ).rejects.toMatchObject({ code: '42501' });
    const left = await db.query<{ nonce: string }>(
      'select nonce from hs.ingest_nonces where key_id=$1 order by nonce',
      [KEY],
    );
    expect(left.rows.map((row) => row.nonce)).toEqual(['synthetic_nonce_0001']);
  });

  it('never lets the operator remove the last active owner', async () => {
    const setMember = (user: string, role: string, active: boolean) =>
      rpc(
        "select hs.admin_set_member($1,$2,'Synthetic member',$3,$4) as value",
        [HOUSE_A, user, role, active],
      );
    await expect(setMember(OWNER_A, 'member', true)).rejects.toThrow(
      'Household needs an active owner',
    );
    await expect(setMember(OWNER_A, 'owner', false)).rejects.toThrow(
      'Household needs an active owner',
    );
    await setMember(MEMBER_A, 'owner', true);
    await setMember(OWNER_A, 'member', true);
    await setMember(OWNER_A, 'owner', true);
    await setMember(MEMBER_A, 'member', true);
  });

  it('refuses bookmarks with credentials or an overlong note', async () => {
    const add = (url: string, note = '') =>
      asUser(
        OWNER_A,
        'select public.hs_add_manual($1,$2,$3,$4,$5::jsonb) as value',
        [HOUSE_A, url, 'Bookmark', note, '[]'],
      );
    await expect(add('https://user:pass@example.invalid/home')).rejects.toThrow(
      'Invalid bookmark',
    );
    await expect(add(`${ORIGIN}/long-note`, '😀'.repeat(1001))).rejects.toThrow(
      'Invalid bookmark',
    );
  });
});
