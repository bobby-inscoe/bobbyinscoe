import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  expandSnapshot,
  snapshotV2Schema,
} from '@/features/house-scanner/api/snapshot-v2';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import { snapshotSchema } from '@/features/house-scanner/types/contracts';

const HOUSE = '10000000-0000-4000-8000-000000000001';
const USER = '20000000-0000-4000-8000-000000000001';
const HOME = '30000000-0000-4000-8000-000000000001';
let db: PGlite;
let temporary: string;
const coordinates = {
  longitude: 11.9586,
  latitude: 57.6987,
  precision: 'address',
  source: 'Synthetic local test',
  observedAt: new Date().toISOString(),
};
async function assignment(value: object | null) {
  const result = await db.query<{ id: string | null }>(
    'select hs.neighborhood_for_coordinates($1::jsonb) as id',
    [JSON.stringify(value)],
  );
  return result.rows[0].id;
}
// The member's v2 snapshot as the database sends it.
async function reply(user = USER, household = HOUSE) {
  await db.exec('begin; set local role authenticated;');
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
      user,
    ]);
    const result = await db.query<{ value: unknown }>(
      'select public.hs_household_snapshot($1) as value',
      [household],
    );
    return snapshotV2Schema.parse(result.rows[0].value);
  } finally {
    await db.exec('rollback;');
  }
}
// The same snapshot as the app builds it.
async function snapshot(user = USER, household = HOUSE) {
  return expandSnapshot(await reply(user, household));
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  for (const name of (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'))
    .sort())
    await db.exec(
      await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'),
    );
  await db.query('insert into auth.users values ($1)', [USER]);
  await db.query(
    "insert into hs.households(id,name) values ($1,'Synthetic household')",
    [HOUSE],
  );
  await db.query(
    "insert into hs.members(household_id,user_id,display_name,role) values ($1,$2,'Synthetic member','owner')",
    [HOUSE, USER],
  );
  // The snapshot returns catalog listings that an enabled profile can use.
  await db.query(
    "insert into hs.profiles(household_id,name,enabled,criteria,edited_by) values ($1,'Synthetic profile',true,$2::jsonb,$3)",
    [HOUSE, JSON.stringify(SYNTHETIC_SNAPSHOT.profiles[0].criteria), USER],
  );
  await db.query(
    "insert into hs.sources(source_id,listing_origins,image_origins) values ('synthetic','{https://example.invalid}','{}')",
  );
  // What the sources rollback restores, for the write-path test below.
  await db.query(
    'insert into hs.source_policies_archive(source_id,policy) values (\'synthetic\',\'{"sourceId":"synthetic","listingOrigins":["https://example.invalid"]}\')',
  );
  const value = {
    ...SYNTHETIC_SNAPSHOT.listings[0],
    sourceUrl: 'https://example.invalid/home',
    coordinates,
    photo: null,
    evidence: [],
  };
  await db.query(
    "insert into hs.listings(id,source_id,source_listing_id,episode_id,value) values ($1,'synthetic','home','first',$2::jsonb)",
    [HOME, JSON.stringify(value)],
  );
  // The migration can precede reference-data loading, with the old response still valid.
  expect(
    (
      await db.query<{ neighborhood_id: string | null }>(
        'select neighborhood_id from hs.listings',
      )
    ).rows[0].neighborhood_id,
  ).toBeNull();
  temporary = await mkdtemp(join(tmpdir(), 'scanner-neighborhoods-'));
  execFileSync(process.execPath, [
    fileURLToPath(
      new URL(
        '../../tools/house-scanner/neighborhoods-sql.mjs',
        import.meta.url,
      ),
    ),
    '--chunked',
    temporary,
  ]);
  const files = (await readdir(temporary)).sort();
  for (const file of files.slice(0, -2))
    await db.exec(await readFile(join(temporary, file), 'utf8'));
  const final = await readFile(join(temporary, files.at(-1) ?? ''), 'utf8');
  await expect(db.exec(final)).rejects.toThrow(
    'Incomplete neighborhood seed upload',
  );
  await db.exec('rollback;');
  await db.exec(await readFile(join(temporary, files.at(-2) ?? ''), 'utf8'));
  await db.exec(final);
});
afterAll(async () => {
  await db?.close();
  if (temporary)
    for (const file of await readdir(temporary))
      await rm(join(temporary, file));
  if (temporary) await rmdir(temporary);
});

describe('official polygon assignments and compatibility', () => {
  it('loads all 96 official areas and backfills stored listings', async () => {
    expect(
      (
        await db.query<{ count: number }>(
          'select count(*)::int as count from hs.neighborhoods',
        )
      ).rows[0].count,
    ).toBe(96);
    expect(
      (
        await db.query<{ neighborhood_id: string }>(
          'select neighborhood_id from hs.listings',
        )
      ).rows[0].neighborhood_id,
    ).toBe('goteborg-107');
    expect(await assignment(coordinates)).toBe('goteborg-107');
    expect(
      await assignment({
        ...coordinates,
        estimated: true,
        source: 'Estimated from the address (OpenStreetMap)',
      }),
    ).toBe('goteborg-107');
    expect(
      await assignment({
        ...coordinates,
        estimated: true,
        source: 'Estimated from the street name (OpenStreetMap)',
      }),
    ).toBeNull();
  });
  it('assigns address estimates but leaves uncertain, coarse and outside positions unassigned', async () => {
    for (const value of [
      null,
      { ...coordinates, estimated: true },
      { ...coordinates, precision: 'approximate_area' },
      { ...coordinates, longitude: 0, latitude: 0 },
    ])
      expect(await assignment(value)).toBeNull();
    expect(await assignment({ ...coordinates, precision: 'building' })).toBe(
      'goteborg-107',
    );
  });
  it('sends official names and the discovery dates with each home', async () => {
    const enriched = await snapshot();
    expect(enriched.listings[0].firstSeenAt).toBeTruthy();
    expect(enriched.listings[0].lastChangedAt).toBeTruthy();
    expect(enriched.listings[0].lastCheckedAt).toBeTruthy();
    expect(enriched.listings[0].isNew).toBe(false);
    expect(enriched.listings[0].neighborhoodRadiusM).toBe(0);
    expect(
      enriched.listings[0].neighborhoodCandidates?.map(({ id }) => id),
    ).toEqual(['goteborg-107']);
    expect(enriched.listings[0].neighborhood).toEqual({
      id: 'goteborg-107',
      name: 'Haga',
      method: 'polygon',
      datasetVersion: 'goteborg-primary-areas-2025',
    });
    expect(snapshotSchema.parse(enriched)).toEqual(enriched);
  });
  it('sends each area once in the v2 snapshot', async () => {
    const parsed = await reply();
    expect(parsed.listings[0]).toMatchObject({
      neighborhoodId: 'goteborg-107',
      neighborhoodIds: ['goteborg-107'],
      neighborhoodRadiusM: 0,
    });
    expect(parsed.neighborhoods).toEqual({
      'goteborg-107': {
        name: 'Haga',
        datasetVersion: 'goteborg-primary-areas-2025',
      },
    });
  });
  it('updates and clears assignments when future ingestion changes the coordinates', async () => {
    await db.query(
      "update hs.listings set value=jsonb_set(value,'{coordinates}',$1::jsonb) where id=$2",
      [JSON.stringify({ ...coordinates, estimated: true }), HOME],
    );
    expect(
      (
        await db.query<{ neighborhood_id: string | null }>(
          'select neighborhood_id from hs.listings',
        )
      ).rows[0].neighborhood_id,
    ).toBeNull();
    await db.query(
      "update hs.listings set value=jsonb_set(value,'{coordinates}',$1::jsonb) where id=$2",
      [JSON.stringify(coordinates), HOME],
    );
    expect(
      (
        await db.query<{ neighborhood_id: string }>(
          'select neighborhood_id from hs.listings',
        )
      ).rows[0].neighborhood_id,
    ).toBe('goteborg-107');
  });
  it('keeps discovery and change dates stable during an ordinary source refresh', async () => {
    const before = await db.query<{
      first_seen_at: string;
      last_changed_at: string;
    }>('select first_seen_at,last_changed_at from hs.listings where id=$1', [
      HOME,
    ]);
    await db.query(
      "update hs.listings set value=jsonb_set(value,'{observedAt}',to_jsonb(now()::text)),last_checked_at=now() where id=$1",
      [HOME],
    );
    const after = await db.query<{
      first_seen_at: string;
      last_changed_at: string;
    }>('select first_seen_at,last_changed_at from hs.listings where id=$1', [
      HOME,
    ]);
    expect(after.rows[0]).toEqual(before.rows[0]);
    await db.query(
      "update hs.listings set revision=revision+1,value=jsonb_set(value,'{facts,askingPriceSek}','2700000'::jsonb) where id=$1",
      [HOME],
    );
    const changed = await db.query<{
      first_seen_at: string;
      last_changed_at: string;
    }>('select first_seen_at,last_changed_at from hs.listings where id=$1', [
      HOME,
    ]);
    expect(changed.rows[0].first_seen_at).toEqual(before.rows[0].first_seen_at);
    expect(changed.rows[0].last_changed_at).not.toEqual(
      before.rows[0].last_changed_at,
    );
  });

  it('does not expose derived areas after coordinate retention expires', async () => {
    await db.query(
      "insert into hs.favorites(household_id,listing_id,user_id,bookmark_url) values ($1,$2,$3,'https://example.invalid/home')",
      [HOUSE, HOME, USER],
    );
    const expired = {
      ...coordinates,
      observedAt: new Date(Date.now() - 31 * 86400000).toISOString(),
    };
    await db.query(
      "update hs.listings set value=jsonb_set(value,'{coordinates}',$1::jsonb) where id=$2",
      [JSON.stringify(expired), HOME],
    );
    const result = await snapshot();
    expect(result.listings[0].coordinates).toBeNull();
    expect(result.listings[0].neighborhood).toBeUndefined();
    expect(result.listings[0].neighborhoodCandidates).toBeUndefined();
    expect(result.listings[0].neighborhoodRadiusM).toBeUndefined();
  });
  it('denies foreign households, revoked members and anonymous execution', async () => {
    await expect(
      snapshot(USER, '10000000-0000-4000-8000-000000000002'),
    ).rejects.toThrow('Household access denied');
    await db.query('update hs.members set active=false where user_id=$1', [
      USER,
    ]);
    await expect(snapshot()).rejects.toThrow('Household access denied');
    const grants = await db.query<{ anon: boolean; authenticated: boolean }>(
      "select has_function_privilege('anon','public.hs_household_snapshot(uuid)','execute') as anon, has_function_privilege('authenticated','public.hs_household_snapshot(uuid)','execute') as authenticated",
    );
    expect(grants.rows[0]).toEqual({ anon: false, authenticated: true });
  });
  it('handles islands, holes and shared boundaries deterministically', async () => {
    await db.exec(
      "insert into hs.neighborhoods values ('test-a','Synthetic A','test'),('test-b','Synthetic B','test'); insert into hs.neighborhood_shapes (neighborhood_id,part,outline,holes) values ('test-a',0,'((0,0),(4,0),(4,4),(0,4),(0,0))',array['((1,1),(2,1),(2,2),(1,2),(1,1))'::polygon]),('test-a',1,'((8,8),(9,8),(9,9),(8,9),(8,8))','{}'),('test-b',0,'((4,0),(5,0),(5,4),(4,4),(4,0))','{}');",
    );
    expect(
      await assignment({ ...coordinates, longitude: 1.5, latitude: 1.5 }),
    ).toBeNull();
    expect(
      await assignment({ ...coordinates, longitude: 8.5, latitude: 8.5 }),
    ).toBe('test-a');
    expect(
      await assignment({ ...coordinates, longitude: 4, latitude: 3 }),
    ).toBe('test-a');
    const candidates = await db.query<{ ids: string[] }>(
      'select hs.neighborhood_candidate_ids($1::jsonb) as ids',
      [JSON.stringify({ ...coordinates, longitude: 4, latitude: 3 })],
    );
    expect(candidates.rows[0].ids).toEqual(['test-a', 'test-b']);
    const holeBorder = await db.query<{ ids: string[] }>(
      'select hs.neighborhood_candidate_ids($1::jsonb) as ids',
      [JSON.stringify({ ...coordinates, longitude: 1, latitude: 1.5 })],
    );
    expect(holeBorder.rows[0].ids).toEqual(['test-a']);
  });
  it('gives the same answers through the box indexes as the scan of every shape', async () => {
    const WRITE_PATH = '20261022102043_house_scanner_write_path';
    const SOURCES = '20261023150000_house_scanner_sources';
    const file = (name: string) =>
      readFile(new URL(`../${name}.sql`, import.meta.url), 'utf8');
    // A grid over the city and the first corner of every tenth shape, which lies on its border, for an exact source
    // point and both kinds of estimate.
    const answers = async () =>
      (
        await db.query<{ value: unknown }>(`
          with points as (
            select 11.75+0.4*x/14.0 lon,57.6+0.25*y/14.0 lat from generate_series(0,14) x,generate_series(0,14) y
            union all
            select m[1]::double precision,m[2]::double precision from (
              select regexp_match(outline::text,'^\\(\\(([^,]+),([^)]+)\\)') m,row_number() over (order by neighborhood_id,part) n
              from hs.neighborhood_shapes where neighborhood_id like 'goteborg-%') corners where n%10=0),
          kinds(kind) as (values
            ('{"precision":"address","source":"Synthetic"}'::jsonb),
            ('{"precision":"address","estimated":true,"source":"Estimated from the address (OpenStreetMap)"}'),
            ('{"precision":"street","estimated":true,"source":"Estimated from the street name (OpenStreetMap)"}')),
          asked as (select kind||jsonb_build_object('longitude',lon,'latitude',lat) c from points,kinds)
          select jsonb_agg(jsonb_build_array(c,hs.neighborhood_candidate_ids(c),hs.neighborhood_for_coordinates(c)) order by c::text) value
          from asked`)
      ).rows[0].value as [object, string[], string | null][];
    const indexed = await answers();
    // Shared buffers one lookup of each kind reads once its plans are cached; the scan of every shape read about 400.
    const buffers = async (value: object) => {
      const sql = `explain (analyze, buffers, format json) select hs.neighborhood_candidate_ids($1::jsonb),hs.neighborhood_for_coordinates($1::jsonb)`;
      await db.query(sql, [JSON.stringify(value)]);
      const plan = (
        await db.query<{ 'QUERY PLAN': { Plan: Record<string, number> }[] }>(
          sql,
          [JSON.stringify(value)],
        )
      ).rows[0]['QUERY PLAN'][0].Plan;
      return plan['Shared Hit Blocks'] + plan['Shared Read Blocks'];
    };
    for (const estimate of [
      {},
      {
        estimated: true,
        source: 'Estimated from the address (OpenStreetMap)',
      },
      {
        estimated: true,
        source: 'Estimated from the street name (OpenStreetMap)',
      },
    ])
      expect(await buffers({ ...coordinates, ...estimate })).toBeLessThan(60);
    await db.exec(await file(`rollbacks/${SOURCES}_down`));
    await db.exec(await file(`rollbacks/${WRITE_PATH}_down`));
    const scanned = await answers();
    await db.exec(await file(`migrations/${WRITE_PATH}`));
    await db.exec(await file(`migrations/${SOURCES}`));
    expect(indexed).toEqual(scanned);
    expect(indexed.length).toBeGreaterThan(900);
    // The sample reaches matches, several areas at once and no area.
    expect(indexed.some(([, ids]) => ids.length === 1)).toBe(true);
    expect(indexed.some(([, ids]) => ids.length > 1)).toBe(true);
    expect(indexed.some(([, ids]) => ids.length === 0)).toBe(true);
    expect(indexed.some(([, , id]) => id !== null)).toBe(true);
  }, 120_000);
});
