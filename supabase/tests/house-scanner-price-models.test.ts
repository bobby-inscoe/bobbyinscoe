import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Price models from publish results (spec: house-scanner-price-estimates, S2).
let db: PGlite;
const model = {
  version: 1,
  fittedAt: '2026-10-23T12:00:00.000Z',
  homes: 1985,
  period: '2026H2',
  intercept: 12.1,
  logArea: 0.715,
  feePerM2: -0.0042,
  rooms: 0,
  typicalFeePerM2: 70,
  residualSd: 0.177,
  levels: { majorna: { level: 0.2, homes: 40 } },
};

// Publishes a staging run with the given results, as hs_ingest does at its end.
async function publish(results: unknown[]) {
  const id = randomUUID();
  await db.query(
    "insert into hs.runs(id,key_id,source_ids,begin_hash) values ($1,'synthetic-key',array['lundin'],'hash')",
    [id],
  );
  await db.query(
    "update hs.runs set state='published',results=$2::jsonb where id=$1",
    [id, JSON.stringify(results)],
  );
  const rows = await db.query<{ source_id: string; homes: number }>(
    'select source_id,homes from hs.price_models where run_id=$1',
    [id],
  );
  return rows.rows;
}
const result = (over: Record<string, unknown>) => ({
  sourceId: 'lundin',
  status: 'partial',
  coverageNote: '',
  cursor: null,
  ...over,
});

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
  await db.query(
    "insert into hs.ingest_credentials(key_id,source_ids,expires_at) values ('synthetic-key',array['lundin'],now()+interval '1 day')",
  );
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe('hs.price_models', () => {
  it('keeps a valid model from a published result', async () => {
    expect(await publish([result({ priceModel: model })])).toEqual([
      { source_id: 'lundin', homes: 1985 },
    ]);
  });

  it('leaves out a failed result, a missing model and one that names a home or a small level, and still publishes', async () => {
    expect(
      await publish([result({ status: 'failed', priceModel: model })]),
    ).toEqual([]);
    expect(await publish([result({})])).toEqual([]);
    expect(
      await publish([
        result({ priceModel: { ...model, address: 'Exempelgatan 1' } }),
      ]),
    ).toEqual([]);
    expect(
      await publish([
        result({
          priceModel: { ...model, levels: { liten: { level: 1, homes: 4 } } },
        }),
      ]),
    ).toEqual([]);
    expect(
      await publish([
        result({
          priceModel: {
            ...model,
            levels: { majorna: { level: 1, homes: 9, priceSek: 1 } },
          },
        }),
      ]),
    ).toEqual([]);
  });

  it('refuses a stored model that fails the check', async () => {
    await expect(
      db.query(
        "insert into hs.price_models(run_id,source_id,fitted_at,homes,model) select id,'lundin',now(),1,'{}' from hs.runs limit 1",
      ),
    ).rejects.toThrow();
  });
});
