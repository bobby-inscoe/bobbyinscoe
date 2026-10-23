import { fakeFetch } from '@house-scanner-tools/live-test-helpers';
import { collectSold } from '@house-scanner-tools/sold-collect';
import type { SoldPool } from '@house-scanner-tools/sold-pool';
import { describe, expect, it } from 'vitest';

const now = Date.parse('2026-10-23T12:00:00.000Z');
const deps = (impl: typeof fetch) => ({
  fetch: impl,
  sleep: async () => {},
  now: () => now,
  random: () => 0,
});
const row = {
  priceSek: 3_000_000,
  areaM2: 60,
  feeSek: 3500,
  rooms: 2,
  period: '2026H2',
  neighbourhood: null,
  final: true,
};
const list = (pages: Record<string, unknown>[]) => ({
  sourceId: 'stadshem',
  origin: 'https://example.invalid',
  url: (page: number) => `https://example.invalid/sold?page=${page}`,
  headers: { rsc: '1' },
  read: (body: string) => JSON.parse(body),
  pages,
});
const page = (ids: string[], oldest: string, last = false) => ({
  rows: Object.fromEntries(ids.map((id) => [id, row])),
  ids,
  oldest,
  last,
});

describe('collectSold', () => {
  it('reads back two years under robots.txt, then keeps the rows by hand in the pool', async () => {
    const pages = [
      page(['a', 'b'], '2026-01-01'),
      page(['c'], '2024-09-01'),
      page(['d'], '2024-01-01'),
    ];
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? { body: 'User-agent: *\nDisallow: /api/\n', type: 'text/plain' }
        : {
            body: JSON.stringify(
              pages[Number(new URL(url).searchParams.get('page'))],
            ),
            type: 'application/json',
          },
    );
    const pool: SoldPool = {};
    const [report] = await collectSold(pool, [], deps(impl), [list(pages)]);
    expect(report).toEqual({
      sourceId: 'stadshem',
      pages: 2,
      rows: 3,
      stopped: 'two-years',
      anchors: 0,
    });
    expect(Object.keys(pool.stadshem.rows)).toHaveLength(3);
    expect(pool.stadshem.manual).toBe(true);
    expect(calls[1].init.headers).toMatchObject({ rsc: '1' });
  });

  it('stops before any page robots.txt disallows, and at a refusal', async () => {
    const blocked = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? { body: 'User-agent: *\nDisallow: /sold\n', type: 'text/plain' }
        : { body: '{}' },
    );
    const [report] = await collectSold({}, [], deps(blocked.impl), [list([])]);
    expect(report.stopped).toBe('robots');
    expect(blocked.calls).toHaveLength(1);
    const refused = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? { body: '', type: 'text/plain' }
        : { status: 429 },
    );
    expect(
      (await collectSold({}, [], deps(refused.impl), [list([])]))[0].stopped,
    ).toBe('http-429');
  });
});

describe('dating a list by place', () => {
  it('opens anchor homes, interpolates the rest, and leaves out rows past two years', async () => {
    const ids = (page: number) =>
      Array.from({ length: 4 }, (_, i) => `${page}-${i}`);
    const listPage = (page: number) => ({
      rows: Object.fromEntries(
        ids(page).map((id) => [id, { ...row, period: '2025H2' }]),
      ),
      ids: ids(page),
      oldest: null,
      last: false,
    });
    // Sale dates by home: the list loses about a month per row.
    const dateOf = (id: string) => {
      const [page, i] = id.split('-').map(Number);
      return new Date(Date.UTC(2026, 9 - (page * 4 + i), 15))
        .toISOString()
        .slice(0, 10);
    };
    const { impl, calls } = fakeFetch((url) => {
      if (url.endsWith('/robots.txt')) return { body: '', type: 'text/plain' };
      const home = /\/home\/(.+)$/.exec(url);
      if (home)
        return { body: `{"agreementDate":"${dateOf(home[1])}T10:00:00"}` };
      return {
        body: JSON.stringify(
          listPage(Number(new URL(url).searchParams.get('page'))),
        ),
        type: 'application/json',
      };
    });
    const pool: SoldPool = {};
    const [report] = await collectSold(
      pool,
      [],
      deps(impl),
      [
        {
          ...list([]),
          sourceId: 'erik-olsson',
          anchor: {
            url: (id: string) => `https://example.invalid/home/${id}`,
            date: (body: string) =>
              /"agreementDate":"(\d{4}-\d{2}-\d{2})/.exec(body)?.[1] ?? null,
          },
        },
      ],
      12,
    );
    // Anchors on pages 0, 5 and 10 (which reaches past two years) and the last home read.
    expect(report).toMatchObject({
      pages: 11,
      stopped: 'two-years',
      anchors: 4,
    });
    expect(calls.filter((c) => c.url.includes('/home/'))).toHaveLength(4);
    const kept = Object.values(pool['erik-olsson'].rows);
    // 44 rows read; those dated before 2024-10-23 are left out. Interpolation is linear in place and months are not,
    // so a row at the edge can land a few days either side of the cut.
    expect(kept.length).toBeGreaterThanOrEqual(22);
    expect(kept.length).toBeLessThanOrEqual(25);
    expect(
      kept.every(
        (r) => r.soldOnEstimated && r.soldOn && r.soldOn >= '2024-10-23',
      ),
    ).toBe(true);
    expect(kept.map((r) => r.period)).toContain('2026H2');
    expect(kept.map((r) => r.period)).toContain('2025H1');
  });
});

describe('a later read', () => {
  it('stops at the first page the pool already has and keeps the stored rows as they were', async () => {
    const pages = [
      page(['new1', 'old1'], '2026-10-01'),
      page(['old2', 'old3'], '2026-09-01'),
      page(['old4'], '2026-08-01'),
    ];
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? { body: '', type: 'text/plain' }
        : {
            body: JSON.stringify(
              pages[Number(new URL(url).searchParams.get('page'))],
            ),
            type: 'application/json',
          },
    );
    const pool: SoldPool = {};
    await collectSold(
      pool,
      [],
      deps(
        fakeFetch(() => ({
          body: JSON.stringify(
            page(['old1', 'old2', 'old3', 'old4'], '2026-08-01', true),
          ),
        })).impl,
      ),
      [list([])],
    );
    const stored = { ...pool.stadshem.rows };
    const [report] = await collectSold(pool, [], deps(impl), [list(pages)]);
    expect(report).toMatchObject({ pages: 2, stopped: 'known' });
    expect(calls.filter((c) => c.url.includes('/sold'))).toHaveLength(2);
    expect(Object.keys(pool.stadshem.rows)).toHaveLength(5);
    for (const [key, row] of Object.entries(stored))
      expect(pool.stadshem.rows[key]).toEqual(row);
  });
});
