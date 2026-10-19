import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The rollback for the personal-hide migration must leave the database as it was before that migration: the
// same snapshot function, schema and grants, and no hidden table or hide function.
const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const BEFORE = [
  '../migrations/202610120001_house_scanner.sql',
  '../migrations/202610120002_house_scanner_retention.sql',
];
const HIDE = '../migrations/202610170001_house_scanner_hidden.sql';
const DOWN = '../rollbacks/202610170001_house_scanner_hidden_down.sql';
const NOTES = '../migrations/202610170002_house_scanner_snapshot_notes.sql';
const DOWN_NOTES =
  '../rollbacks/202610170002_house_scanner_snapshot_notes_down.sql';

async function create(paths: string[]) {
  const db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  for (const path of paths) await db.exec(await read(path));
  return db;
}

// Everything about the objects the migration touches, as text.
async function describeObjects(db: PGlite) {
  const result = await db.query<{ line: string }>(`
    select 'fn ' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
      || md5(pg_get_functiondef(p.oid)) || ' anon=' || has_function_privilege('anon', p.oid, 'execute')
      || ' auth=' || has_function_privilege('authenticated', p.oid, 'execute')
      || ' svc=' || has_function_privilege('service_role', p.oid, 'execute') as line
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('hs', 'public') and (p.proname like '%snapshot%' or p.proname like '%hidden%')
    union all
    select 'table hs.' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'hs' and c.relkind = 'r' and c.relname like '%hidden%'
    order by line
  `);
  return result.rows.map((row) => row.line);
}

let before: string[];
let rolledBack: string[];
let migrated: string[];
let beforeDb: PGlite;
let afterDb: PGlite;

beforeAll(async () => {
  beforeDb = await create(BEFORE);
  before = await describeObjects(beforeDb);
  afterDb = await create([...BEFORE, HIDE]);
  migrated = await describeObjects(afterDb);
  await afterDb.exec(await read(DOWN));
  rolledBack = await describeObjects(afterDb);
});

afterAll(async () => {
  await beforeDb?.close();
  await afterDb?.close();
});

describe('rollback of the personal-hide migration', () => {
  it('differs from the state before only by the objects it removes', () => {
    expect(migrated).not.toEqual(before);
    expect(migrated.join('\n')).toContain('hs_set_hidden');
    expect(migrated.join('\n')).toContain('snapshot_base');
  });

  it('restores the snapshot function, its schema and its grants exactly', () => {
    expect(rolledBack).toEqual(before);
    expect(rolledBack.join('\n')).not.toContain('hidden');
    expect(rolledBack.join('\n')).not.toContain('snapshot_base');
  });

  it('takes the notes out of the snapshot again, back to the hide migration’s definition', async () => {
    const afterHide = await create([...BEFORE, HIDE]);
    const expected = await describeObjects(afterHide);
    await afterHide.close();
    const db = await create([...BEFORE, HIDE, NOTES]);
    try {
      expect(await describeObjects(db)).not.toEqual(expected);
      await db.exec(await read(DOWN_NOTES));
      expect(await describeObjects(db)).toEqual(expected);
      await db.exec(await read(NOTES));
      expect(await describeObjects(db)).not.toEqual(expected);
    } finally {
      await db.close();
    }
  });

  it('can be followed by applying the migration again', async () => {
    await afterDb.exec(await read(HIDE));
    expect(await describeObjects(afterDb)).toEqual(migrated);
  });
});

describe('rollback of the viewings migration', () => {
  const VIEWINGS = '../migrations/202610180001_house_scanner_viewings.sql';
  const DOWN_VIEWINGS =
    '../rollbacks/202610180001_house_scanner_viewings_down.sql';
  const ADMIN = '../migrations/202610120003_house_scanner_admin.sql';
  const upTo = [BEFORE[0], BEFORE[1], ADMIN, HIDE, NOTES];

  // The functions the migration touches, with their grants, as text.
  async function objects(db: PGlite) {
    const result = await db.query<{ line: string }>(`
      select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
        || md5(pg_get_functiondef(p.oid)) || ' anon=' || has_function_privilege('anon', p.oid, 'execute')
        || ' auth=' || has_function_privilege('authenticated', p.oid, 'execute') as line
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('hs', 'public')
        and (p.proname like '%snapshot%' or p.proname like '%observation%' or p.proname like '%viewings%')
      order by line
    `);
    return result.rows.map((row) => row.line);
  }

  it('restores the fingerprint, the observation check and the snapshot exactly, and can be reapplied', async () => {
    const plain = await create(upTo);
    const expected = await objects(plain);
    await plain.close();
    const db = await create(upTo);
    try {
      await db.exec(await read(VIEWINGS));
      const migrated = await objects(db);
      expect(migrated).not.toEqual(expected);
      const text = migrated.join(' | ');
      expect(text).toContain('with_viewings');
      expect(text).toContain('assert_observation_facts');
      await db.exec(await read(DOWN_VIEWINGS));
      expect(await objects(db)).toEqual(expected);
      await db.exec(await read(VIEWINGS));
      expect(await objects(db)).toEqual(migrated);
    } finally {
      await db.close();
    }
  });
});
