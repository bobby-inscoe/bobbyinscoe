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
