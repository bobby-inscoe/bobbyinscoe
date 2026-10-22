import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  expandSnapshot,
  snapshotV2Schema,
} from '@/features/house-scanner/api/snapshot-v2';

// Manual listings: photo links and facts on add, then edit and delete by any member of the household.
const OWNER = '30000000-0000-4000-8000-0000000000a1';
const MEMBER = '30000000-0000-4000-8000-0000000000a2';
const STRANGER = '30000000-0000-4000-8000-0000000000b1';
const PHOTO = 'https://example.invalid/a.jpg';
const SECOND = 'https://example.invalid/b.jpg';

let db: PGlite;
let household: string;
let strangerHousehold: string;

async function as<T>(userId: string, action: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    userId,
  ]);
  await db.exec('set role authenticated');
  try {
    return await action();
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  }
}

const call = (user: string, sql: string, params: unknown[] = []) =>
  as(
    user,
    async () => (await db.query<{ value: unknown }>(sql, params)).rows[0].value,
  );

const add = async (user: string, url: string, images: string[], facts = {}) =>
  z
    .object({ listingId: z.uuid() })
    .parse(
      await call(
        user,
        'select public.hs_add_manual($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as value',
        [
          household,
          url,
          'Home',
          '',
          '[]',
          JSON.stringify(images),
          JSON.stringify(facts),
        ],
      ),
    );

const update = (
  user: string,
  listing: string,
  title: string,
  images: string[],
  facts = {},
  home = household,
) =>
  call(
    user,
    'select public.hs_update_manual($1,$2,$3,$4::jsonb,$5::jsonb) as value',
    [home, listing, title, JSON.stringify(images), JSON.stringify(facts)],
  );

const remove = (user: string, listing: string, home = household) =>
  call(user, 'select public.hs_delete_manual($1,$2) as value', [home, listing]);

const listings = async (user: string) =>
  expandSnapshot(
    snapshotV2Schema.parse(
      await call(user, 'select public.hs_household_snapshot($1) as value', [
        household,
      ]),
    ),
  ).listings;

async function migratedDb() {
  const pg = await PGlite.create();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
  const names = (await readdir(new URL('../migrations/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of names)
    await pg.exec(
      await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'),
    );
  return pg;
}

beforeAll(async () => {
  db = await migratedDb();
  for (const id of [OWNER, MEMBER, STRANGER])
    await db.query('insert into auth.users values($1,$2,now())', [
      id,
      `${id}@example.invalid`,
    ]);
  const bootstrap = async (name: string, owner: string) =>
    z
      .object({ householdId: z.uuid() })
      .parse(
        (
          await db.query<{ value: unknown }>(
            "select hs.admin_bootstrap_household($1,$2,'Owner','Main',hs.starter_criteria()) as value",
            [name, owner],
          )
        ).rows[0].value,
      ).householdId;
  household = await bootstrap('Household', OWNER);
  strangerHousehold = await bootstrap('Other', STRANGER);
  await db.query(
    "select hs.admin_set_member($1,$2,'Member','member',true) as value",
    [household, MEMBER],
  );
});

afterAll(() => db.close());

describe('manual listings', () => {
  it('carry photo links and entered facts, lead photo first', async () => {
    const { listingId } = await add(
      OWNER,
      'https://example.invalid/one',
      [PHOTO, SECOND],
      { rooms: 3, outdoor: 'balcony' },
    );
    const listing = (await listings(OWNER)).find((l) => l.id === listingId);
    expect(listing?.photo?.url).toBe(PHOTO);
    expect(listing?.photos?.map((p) => p.url)).toEqual([PHOTO, SECOND]);
    expect(listing?.facts).toMatchObject({ rooms: 3, outdoor: 'balcony' });
  });

  it('refuse a plain http photo, an unknown fact and a bad number', async () => {
    for (const [images, facts] of [
      [['http://example.invalid/a.jpg'], {}],
      [[], { bogus: 1 }],
      [[], { rooms: '3' }],
      [[], { outdoor: 'pool' }],
    ] as const)
      await expect(
        add(OWNER, 'https://example.invalid/bad', [...images], facts),
      ).rejects.toThrow(/Invalid bookmark/);
  });

  it('can be edited by a member who did not add them', async () => {
    const { listingId } = await add(
      OWNER,
      'https://example.invalid/two',
      [PHOTO],
      { rooms: 2 },
    );
    await update(MEMBER, listingId, 'Renamed', [SECOND], {
      askingPriceSek: 2500000,
    });
    const listing = (await listings(OWNER)).find((l) => l.id === listingId);
    expect(listing?.title).toBe('Renamed');
    expect(listing?.photo?.url).toBe(SECOND);
    expect(listing?.facts).toMatchObject({
      askingPriceSek: 2500000,
      rooms: null,
    });
    expect(listing?.sourceUrls).toEqual(['https://example.invalid/two']);
    await update(OWNER, listingId, '', [], {});
    const cleared = (await listings(OWNER)).find((l) => l.id === listingId);
    expect(cleared?.title).toBe('Saved listing');
    expect(cleared?.photo).toBeNull();
  });

  it('refuse an invalid edit and an edit from outside the household', async () => {
    const { listingId } = await add(OWNER, 'https://example.invalid/three', []);
    await expect(
      update(OWNER, listingId, 'x', ['http://example.invalid/a.jpg']),
    ).rejects.toThrow(/Invalid bookmark/);
    await expect(update(STRANGER, listingId, 'x', [])).rejects.toThrow();
    await expect(
      update(STRANGER, listingId, 'x', [], {}, strangerHousehold),
    ).rejects.toThrow(/Listing unavailable/);
  });

  it('are deleted with their favorites and notes, by any member', async () => {
    const { listingId } = await add(OWNER, 'https://example.invalid/four', []);
    await call(OWNER, 'select public.hs_set_favorite($1,$2,true) as value', [
      household,
      listingId,
    ]);
    await call(OWNER, 'select public.hs_save_note($1,$2,$3,0) as value', [
      household,
      listingId,
      'Nice',
    ]);
    await expect(remove(STRANGER, listingId)).rejects.toThrow();
    await remove(MEMBER, listingId);
    expect((await listings(OWNER)).some((l) => l.id === listingId)).toBe(false);
    const left = await db.query(
      'select (select count(*) from hs.favorites where manual_listing_id=$1)+(select count(*) from hs.notes where manual_listing_id=$1) as n',
      [listingId],
    );
    expect(Number((left.rows[0] as { n: unknown }).n)).toBe(0);
    await expect(remove(OWNER, listingId)).rejects.toThrow(
      /Listing unavailable/,
    );
  });

  it('never touch a catalog listing', async () => {
    await expect(
      remove(OWNER, '00000000-0000-4000-8000-0000000000ff'),
    ).rejects.toThrow(/Listing unavailable/);
  });
});

describe('the rollback', () => {
  it('removes edit and delete and leaves adding a link working', async () => {
    const pg = await migratedDb();
    await pg.exec(
      await readFile(
        new URL(
          '../rollbacks/20261021085741_house_scanner_manual_edit_down.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const names = await pg.query<{ proname: string }>(
      "select proname from pg_proc where proname in ('hs_update_manual','hs_delete_manual','manual_extras_invalid','hs_add_manual')",
    );
    expect(names.rows.map((row) => row.proname)).toEqual(['hs_add_manual']);
    await pg.close();
  });
});
