import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import {
  HARD_RULE_BASE_FACTS,
  HARD_RULE_CASES,
  HARD_RULE_CRITERIA,
} from '@/features/house-scanner/utils/hard-rule-cases';

// The shared catalog migration (S1): one household's data before it, many households after it.
const CATALOG = '20261020111540_house_scanner_catalog.sql';
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

function snapshot(
  household = HOUSE_A,
  user = OWNER_A,
  database = db,
  call = 'hs_snapshot_neighborhoods',
) {
  return as(
    'authenticated',
    user,
    async () =>
      snapshotSchema.parse(
        await rpc(`select public.${call}($1) as value`, [household], database),
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
    for (const call of ['hs_snapshot', 'hs_snapshot_neighborhoods'])
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
    const state = before[`${OWNER_A}:hs_snapshot_neighborhoods`] as z.infer<
      typeof snapshotSchema
    >;
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
    expect(
      await asUser(OWNER_B, 'select public.hs_notes($1,$2) as value', [
        HOUSE_B,
        seeded.fresh,
      ]),
    ).toEqual([expect.objectContaining({ userId: OWNER_B })]);
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
    expect(await titles()).not.toContain('too-small-for-b');
    expect((await snapshot(HOUSE_A, OWNER_A)).hides).toHaveLength(2);
  });

  it('serves the same snapshots with the set-based snapshot and after rolling it back', async () => {
    const speed = '20261021194535_house_scanner_snapshot_speed';
    const both = async () => [
      await snapshot(HOUSE_A, OWNER_A),
      await snapshot(HOUSE_B, OWNER_B),
    ];
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
      as('anon', null, () =>
        rpc('select public.hs_snapshot($1) as value', [HOUSE_A]),
      ),
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
