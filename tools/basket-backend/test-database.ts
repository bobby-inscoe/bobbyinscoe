import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export async function createDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, is_anonymous boolean not null default true);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  await db.exec(
    await readFile(
      new URL(
        './supabase/migrations/20261021184307_basket_foundation.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  return db;
}

export async function addIdentity(db: PGlite, id: string, guest = true) {
  await db.query('insert into auth.users values($1,$2,$3,$4)', [
    id,
    guest ? null : `${id}@example.invalid`,
    guest ? null : new Date().toISOString(),
    guest,
  ]);
}

export async function asIdentity(
  db: PGlite,
  id: string | null,
  sql: string,
  params: unknown[] = [],
) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
      id ?? '',
    ]);
    await tx.exec(`set local role ${id ? 'authenticated' : 'anon'}`);
    return (await tx.query<{ value: unknown }>(sql, params)).rows[0]?.value;
  });
}
