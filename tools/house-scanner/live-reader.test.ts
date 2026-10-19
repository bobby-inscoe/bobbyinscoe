import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultLiveDeps,
  type LiveEvent,
  MAX_DETAIL_PAGES_PER_RUN,
  MAX_INTERVAL_MS,
  MAX_REQUESTS_PER_RUN,
  MIN_INTERVAL_MS,
  runCollection,
  USER_AGENT,
} from '@house-scanner-tools/live-reader';
import {
  boneoFixture,
  boneoRobotsOr,
  deps,
  fakeFetch,
  nextPage,
  type Reply,
} from '@house-scanner-tools/live-test-helpers';
import {
  emptyMemory,
  type RunMemory,
  saveMemory,
} from '@house-scanner-tools/run-memory';
import { boneoAdapter } from '@house-scanner-tools/source-adapters';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Observation } from '@/features/house-scanner/types/contracts';

const runBoneoCollection = (
  ...args: Parameters<typeof runCollection> extends [unknown, ...infer Rest]
    ? Rest
    : never
) => runCollection(boneoAdapter, ...args);
const goteborg = [
  {
    id: 'municipality-1',
    municipality: 'Göteborg',
    propertyTypes: ['apartment' as const],
  },
];

afterEach(() => vi.useRealTimers());

describe('guarded run', () => {
  it('sends an honest user agent and no cookies, credentials or redirects', async () => {
    const { impl, calls } = fakeFetch(
      boneoRobotsOr(() => ({ body: nextPage([1], 1) })),
    );
    await runBoneoCollection(goteborg, deps(impl));
    expect(calls).toHaveLength(2);
    for (const { init } of calls) {
      expect(init.headers).toEqual({
        'user-agent': USER_AGENT,
        accept: 'text/html,text/plain',
      });
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('manual');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(USER_AGENT).toBe(
      'HouseScannerPersonalReader/0.1 (private household tool)',
    );
  });

  it('refuses a disallowed path before fetching any search page', async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? {
            body: 'User-agent: *\nDisallow: /sv/till_salu/\n',
            type: 'text/plain',
          }
        : { body: nextPage([1], 1) },
    );
    const result = await runBoneoCollection(goteborg, deps(impl));
    expect(result.stopped).toBe('robots-disallow');
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/robots.txt',
    ]);
    expect(result.observations).toEqual([]);
  });

  it('refuses when robots.txt cannot be read', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 404 }));
    const result = await runBoneoCollection(goteborg, deps(impl));
    expect(result.stopped).toBe('robots-unavailable');
    expect(calls).toHaveLength(1);
  });

  it('waits the two second minimum when the random draw is zero', async () => {
    vi.useFakeTimers();
    const { impl, spy } = fakeFetch(
      boneoRobotsOr((_url, n) => ({ body: nextPage([n], 9) })),
    );
    const run = runBoneoCollection(goteborg, {
      ...defaultLiveDeps(() => undefined),
      fetch: impl,
      random: () => 0,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(spy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(20_000);
    await run;
  });

  it('draws each gap between 2000 and 4000 ms from the random source', async () => {
    expect([MIN_INTERVAL_MS, MAX_INTERVAL_MS]).toEqual([2000, 4000]);
    const draws = [0, 1, 0.5, 0.25, 0.999, 0.0001];
    const stamps: number[] = [];
    const fake = fakeFetch(
      boneoRobotsOr((_url, n) => ({ body: nextPage([n], 9) })),
    );
    let index = 0;
    const base = deps(fake.impl, [], () => draws[index++ % draws.length]);
    await runBoneoCollection(goteborg, {
      ...base,
      fetch: ((...args: Parameters<typeof fetch>) => {
        stamps.push(base.now());
        return fake.impl(...args);
      }) as typeof fetch,
    });
    const gaps = stamps.slice(1).map((at, i) => at - stamps[i]);
    expect(gaps).toHaveLength(9);
    // One draw per request after the first, in order.
    draws.forEach((draw, i) => {
      expect(gaps[i]).toBeCloseTo(MIN_INTERVAL_MS + draw * 2000, 2);
    });
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
      expect(gap).toBeLessThanOrEqual(MAX_INTERVAL_MS);
    }
  });

  it.each([0, 0.3, 0.7, 1])(
    'keeps every gap inside the window when the draw is %s',
    async (draw) => {
      const stamps: number[] = [];
      const fake = fakeFetch(
        boneoRobotsOr((_url, n) => ({ body: nextPage([n], 5) })),
      );
      const base = deps(fake.impl, [], () => draw);
      await runBoneoCollection(
        goteborg,
        {
          ...base,
          fetch: ((...args: Parameters<typeof fetch>) => {
            stamps.push(base.now());
            return fake.impl(...args);
          }) as typeof fetch,
        },
        (all) => all,
      );
      const gaps = stamps.slice(1).map((at, i) => at - stamps[i]);
      expect(gaps.length).toBeGreaterThan(5);
      expect(Math.min(...gaps)).toBeCloseTo(2000 + draw * 2000, 2);
      expect(Math.max(...gaps)).toBeCloseTo(2000 + draw * 2000, 2);
    },
  );

  it('stops at forty pages per partition and reports truncation', async () => {
    let id = 0;
    const { impl, calls } = fakeFetch(
      boneoRobotsOr(() => ({ body: nextPage([++id, ++id], 500) })),
    );
    const result = await runBoneoCollection(goteborg, deps(impl));
    expect(calls.filter((c) => !c.url.endsWith('robots.txt'))).toHaveLength(40);
    expect(calls.at(-1)?.url).toContain('?page=40');
    expect(result.partitions[0]).toMatchObject({
      status: 'truncated',
      reason: 'page-cap',
      pages: 40,
      total: 500,
    });
  });

  it('stops at one thousand observations per run and reports truncation', async () => {
    let id = 0;
    const { impl, calls } = fakeFetch(
      boneoRobotsOr(() => ({
        body: nextPage(
          Array.from({ length: 30 }, () => ++id),
          5000,
        ),
      })),
    );
    const result = await runBoneoCollection(goteborg, deps(impl));
    expect(result.observations).toHaveLength(1000);
    expect(calls).toHaveLength(35);
    expect(result.partitions[0]).toMatchObject({
      status: 'truncated',
      reason: 'observation-cap',
      pages: 34,
      observations: 1000,
    });
  });

  it('stops at 250 requests per run including robots.txt', async () => {
    let id = 0;
    const { impl, calls } = fakeFetch(
      boneoRobotsOr(() => ({ body: nextPage([++id], 500) })),
    );
    const many = Array.from({ length: 8 }, (_v, index) => ({
      ...goteborg[0],
      id: `municipality-${index + 1}`,
    }));
    const result = await runBoneoCollection(many, deps(impl));
    expect(calls).toHaveLength(250);
    expect(result.requestCount).toBe(250);
    expect(result.stopped).toBe('request-cap');
  });

  it.each([
    [500, 'http-non-200'],
    [404, 'http-non-200'],
    [302, 'http-non-200'],
    [403, 'http-403'],
    [429, 'http-429'],
  ])('stops on status %i without retrying', async (status, reason) => {
    const { impl, calls } = fakeFetch(boneoRobotsOr(() => ({ status })));
    const result = await runBoneoCollection(goteborg, deps(impl));
    expect(result.stopped).toBe(reason);
    expect(calls).toHaveLength(2);
    expect(result.partitions[0]).toMatchObject({ status: 'failed', reason });
  });

  it('stops on a network error or timeout', async () => {
    const cases: [Error, string][] = [
      [new TypeError('socket'), 'network-error'],
      [new DOMException('late', 'TimeoutError'), 'timeout'],
    ];
    for (const [error, reason] of cases) {
      const { impl } = fakeFetch(boneoRobotsOr(() => error));
      const result = await runBoneoCollection(goteborg, deps(impl));
      expect(result.stopped).toBe(reason);
    }
  });

  it('treats a page without embedded data as failed coverage, not empty', async () => {
    const { impl } = fakeFetch(
      boneoRobotsOr(() => ({ body: boneoFixture('blocked-page.html') })),
    );
    const result = await runBoneoCollection(goteborg, deps(impl));
    expect(result.stopped).toBe('no-embedded-data');
    expect(result.partitions[0]).toMatchObject({
      status: 'failed',
      reason: 'no-embedded-data',
      observations: 0,
    });
  });

  it('reads several pages and de-duplicates across them', async () => {
    const { impl } = fakeFetch(
      boneoRobotsOr((url) => ({
        body: url.includes('page=2')
          ? nextPage([2, 3], 4)
          : nextPage([1, 2], 4),
      })),
    );
    const result = await runBoneoCollection(goteborg, deps(impl));
    expect(result.observations.map((o) => o.sourceListingId)).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(result.partitions[0]).toMatchObject({ status: 'read', pages: 2 });
  });

  it('marks unsupported municipalities without requesting them', async () => {
    const { impl, calls } = fakeFetch(boneoRobotsOr(() => ({ body: '' })));
    const result = await runBoneoCollection(
      [
        {
          id: 'municipality-1',
          municipality: 'Malmö',
          propertyTypes: ['apartment'],
        },
      ],
      deps(impl),
    );
    expect(result.partitions[0].status).toBe('unsupported');
    expect(calls).toHaveLength(1);
  });

  it('logs counts, statuses and partition names only', async () => {
    const events: LiveEvent[] = [];
    const { impl } = fakeFetch(
      boneoRobotsOr(() => ({ body: boneoFixture('search-page.html') })),
    );
    await runBoneoCollection(goteborg, deps(impl, events));
    const text = JSON.stringify(events);
    for (const value of [
      'Exempelgatan',
      'fixture',
      'boneo.se',
      '3001000',
      'Göteborg',
      'https://',
    ])
      expect(text).not.toContain(value);
    expect(events.some((event) => event.partition === 'municipality-1')).toBe(
      true,
    );
  });
});

describe('listing pages', () => {
  const isDetail = (url: string) => url.includes('/bostad/');
  const listingId = (url: string) => Number(url.split('-').at(-1));
  // 25 listings per page, ids 1..total, like a real multi-page result.
  const searchReply = (url: string, total: number) => {
    const page = Number(new URL(url).searchParams.get('page') ?? '1');
    const first = (page - 1) * 25 + 1;
    const last = Math.min(total, page * 25);
    const ids = Array.from({ length: last - first + 1 }, (_v, i) => first + i);
    return { body: nextPage(ids, total) };
  };
  const serve =
    (total: number, detail: (id: number) => Reply) =>
    (url: string): Reply =>
      isDetail(url) ? detail(listingId(url)) : searchReply(url, total);
  const detailCalls = (calls: { url: string }[]) =>
    calls.filter((call) => isDetail(call.url));
  const BALCONY = boneoFixture('detail-balcony.html');
  const keepAll = (all: Observation[]) => all;

  it('reads each kept listing page once and merges only outdoor and glazed', async () => {
    const files = [
      'detail-balcony.html',
      'detail-both.html',
      'detail-glazed.html',
    ];
    const { impl, calls } = fakeFetch(
      boneoRobotsOr(serve(3, (id) => ({ body: boneoFixture(files[id - 1]) }))),
    );
    const result = await runBoneoCollection(goteborg, deps(impl), keepAll);
    expect(
      result.observations.map((o) => [o.facts.outdoor, o.facts.glazed]),
    ).toEqual([
      ['balcony', null],
      ['both', null],
      ['balcony', true],
    ]);
    expect(result).toMatchObject({
      detailRead: 3,
      detailFailed: 0,
      detailSkipped: 0,
      requestCount: 5,
      stopped: null,
    });
    expect(calls.filter((c) => c.url.endsWith('/robots.txt'))).toHaveLength(1);
    expect(detailCalls(calls).map((c) => new URL(c.url).pathname)).toEqual([
      '/bostad/fixture-1',
      '/bostad/fixture-2',
      '/bostad/fixture-3',
    ]);
    for (const { init } of calls) {
      expect(init.headers).toEqual({
        'user-agent': USER_AGENT,
        accept: 'text/html,text/plain',
      });
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('manual');
    }
  });

  it('reads no listing page unless the caller keeps the observation', async () => {
    const { impl, calls } = fakeFetch(
      boneoRobotsOr(serve(3, () => ({ body: BALCONY }))),
    );
    const result = await runBoneoCollection(goteborg, deps(impl), (all) =>
      all.filter((o) => o.sourceListingId === '2'),
    );
    expect(detailCalls(calls).map((c) => c.url)).toEqual([
      'https://www.boneo.se/bostad/fixture-2',
    ]);
    expect(result.observations.map((o) => o.facts.outdoor)).toEqual([
      null,
      'balcony',
      null,
    ]);
    const plain = fakeFetch(boneoRobotsOr(serve(3, () => ({ body: BALCONY }))));
    await runBoneoCollection(goteborg, deps(plain.impl));
    expect(detailCalls(plain.calls)).toHaveLength(0);
  });

  it('waits at least two seconds before every listing page', async () => {
    vi.useFakeTimers();
    const { impl, spy } = fakeFetch(
      boneoRobotsOr(serve(2, () => ({ body: BALCONY }))),
    );
    const run = runBoneoCollection(
      goteborg,
      { ...defaultLiveDeps(() => undefined), fetch: impl, random: () => 0 },
      keepAll,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(spy).toHaveBeenCalledTimes(1);
    // search page, then two listing pages
    for (const expected of [2, 3, 4]) {
      await vi.advanceTimersByTimeAsync(1999);
      expect(spy).toHaveBeenCalledTimes(expected - 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(spy).toHaveBeenCalledTimes(expected);
    }
    await run;
  });

  it('skips listing pages that robots.txt disallows, without failing the run', async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? {
            body: 'User-agent: *\nAllow: /\nDisallow: /bostad/\n',
            type: 'text/plain',
          }
        : serve(3, () => ({ body: BALCONY }))(url),
    );
    const result = await runBoneoCollection(goteborg, deps(impl), keepAll);
    expect(detailCalls(calls)).toHaveLength(0);
    expect(result).toMatchObject({
      detailRead: 0,
      detailSkipped: 3,
      stopped: null,
    });
    expect(result.observations).toHaveLength(3);
  });

  it('reads at most 150 listing pages per run and counts the rest as skipped', async () => {
    expect(MAX_DETAIL_PAGES_PER_RUN).toBe(150);
    const { impl, calls } = fakeFetch(
      boneoRobotsOr(serve(160, () => ({ body: BALCONY }))),
    );
    const result = await runBoneoCollection(goteborg, deps(impl), keepAll);
    expect(detailCalls(calls)).toHaveLength(150);
    expect(result).toMatchObject({
      detailRead: 150,
      detailFailed: 0,
      detailSkipped: 10,
      requestCount: 158,
      stopped: null,
    });
    expect(
      result.observations.filter((o) => o.facts.outdoor === null),
    ).toHaveLength(10);
  });

  it('shares the 250 request cap with search pages and skips what it cannot request', async () => {
    expect(MAX_REQUESTS_PER_RUN).toBe(250);
    let id = 0;
    const { impl, calls } = fakeFetch(
      boneoRobotsOr((url) =>
        isDetail(url) ? { body: BALCONY } : { body: nextPage([++id], 500) },
      ),
    );
    const four = Array.from({ length: 4 }, (_v, index) => ({
      ...goteborg[0],
      id: `municipality-${index + 1}`,
    }));
    const result = await runBoneoCollection(four, deps(impl), keepAll);
    // robots.txt and 160 search pages leave room for 89 listing pages.
    expect(calls).toHaveLength(250);
    expect(result).toMatchObject({
      requestCount: 250,
      detailRead: 89,
      detailSkipped: 71,
      stopped: null,
    });
  });

  it('counts a failed listing page and carries on', async () => {
    const replies: Reply[] = [
      { status: 500 },
      { status: 404 },
      { body: boneoFixture('blocked-page.html') },
      { body: boneoFixture('detail-wrong-shape.html') },
      { body: BALCONY },
    ];
    const events: LiveEvent[] = [];
    const { impl, calls } = fakeFetch(
      boneoRobotsOr(serve(5, (id) => replies[id - 1])),
    );
    const result = await runBoneoCollection(
      goteborg,
      deps(impl, events),
      keepAll,
    );
    expect(detailCalls(calls)).toHaveLength(5);
    expect(result).toMatchObject({
      detailRead: 1,
      detailFailed: 4,
      detailSkipped: 0,
      stopped: null,
    });
    expect(result.observations.map((o) => o.facts.outdoor)).toEqual([
      null,
      null,
      null,
      null,
      'balcony',
    ]);
    expect(
      events.filter((e) => e.event === 'detail-failed').map((e) => e.reason),
    ).toEqual([
      'http-non-200',
      'http-non-200',
      'no-embedded-data',
      'unexpected-shape',
    ]);
    expect(JSON.stringify(events)).not.toMatch(/https:|boneo|fixture/);
  });

  it.each([
    [{ status: 403 }, 'http-403'],
    [{ status: 429 }, 'http-429'],
    [new TypeError('socket'), 'network-error'],
    [new DOMException('late', 'TimeoutError'), 'timeout'],
  ] as [Reply, string][])(
    'stops the whole run on listing page failure %#',
    async (stop, reason) => {
      const { impl, calls } = fakeFetch(
        boneoRobotsOr(serve(4, (id) => (id === 2 ? stop : { body: BALCONY }))),
      );
      const result = await runBoneoCollection(goteborg, deps(impl), keepAll);
      expect(result.stopped).toBe(reason);
      expect(detailCalls(calls)).toHaveLength(2);
      expect(result).toMatchObject({ detailRead: 1, detailFailed: 0 });
      expect(result.observations.map((o) => o.facts.outdoor)).toEqual([
        'balcony',
        null,
        null,
        null,
      ]);
    },
  );

  describe('run memory', () => {
    const NOW = 1_760_000_000_000;
    const DAY = 86_400_000;
    const remembered = (
      ago: number,
      outdoor: 'terrace' | 'balcony' = 'terrace',
    ) => ({
      outdoor,
      glazed: true,
      readAt: new Date(NOW - ago).toISOString(),
    });
    const memoryOf = (details: RunMemory['details']): RunMemory => ({
      ...emptyMemory(),
      details,
    });
    const rememberedIds = (count: number) =>
      memoryOf(
        Object.fromEntries(
          Array.from({ length: count }, (_v, i) => [
            String(i + 1),
            remembered(DAY),
          ]),
        ),
      );

    it('merges a recent read without any request for that listing', async () => {
      const memory = rememberedIds(3);
      const before = structuredClone(memory);
      const { impl, calls } = fakeFetch(
        boneoRobotsOr(serve(3, () => ({ body: BALCONY }))),
      );
      const result = await runBoneoCollection(
        goteborg,
        deps(impl),
        keepAll,
        memory,
      );
      expect(detailCalls(calls)).toHaveLength(0);
      expect(result).toMatchObject({
        detailRead: 0,
        detailCached: 3,
        detailFailed: 0,
        detailSkipped: 0,
        requestCount: 2,
        stopped: null,
      });
      expect(
        result.observations.map((o) => [o.facts.outdoor, o.facts.glazed]),
      ).toEqual([
        ['terrace', true],
        ['terrace', true],
        ['terrace', true],
      ]);
      expect(memory).toEqual(before);
    });

    it('reads again an entry older than 7 days and replaces it', async () => {
      const memory = memoryOf({
        '1': remembered(8 * DAY),
        '2': remembered(DAY),
      });
      const { impl, calls } = fakeFetch(
        boneoRobotsOr(serve(2, () => ({ body: BALCONY }))),
      );
      const result = await runBoneoCollection(
        goteborg,
        deps(impl),
        keepAll,
        memory,
      );
      expect(detailCalls(calls).map((c) => c.url)).toEqual([
        'https://www.boneo.se/bostad/fixture-1',
      ]);
      expect(result).toMatchObject({ detailRead: 1, detailCached: 1 });
      expect(result.observations.map((o) => o.facts.outdoor)).toEqual([
        'balcony',
        'terrace',
      ]);
      expect(memory.details['1']).toMatchObject({
        outdoor: 'balcony',
        glazed: null,
      });
      const age = Date.parse(memory.details['1'].readAt) - NOW;
      expect(age).toBeGreaterThanOrEqual(0);
      expect(age).toBeLessThan(60_000);
      expect(memory.details['2']).toEqual(remembered(DAY));
    });

    it('stores nothing for pages that failed', async () => {
      const replies: Reply[] = [
        { status: 500 },
        { body: boneoFixture('detail-wrong-shape.html') },
        { body: BALCONY },
      ];
      const memory = memoryOf({});
      const { impl } = fakeFetch(
        boneoRobotsOr(serve(3, (id) => replies[id - 1])),
      );
      const result = await runBoneoCollection(
        goteborg,
        deps(impl),
        keepAll,
        memory,
      );
      expect(result).toMatchObject({ detailRead: 1, detailFailed: 2 });
      expect(Object.keys(memory.details)).toEqual(['3']);
    });

    it('keeps an old entry when the refresh stops the run', async () => {
      const memory = memoryOf({ '1': remembered(8 * DAY) });
      const { impl } = fakeFetch(
        boneoRobotsOr(serve(2, () => ({ status: 403 }))),
      );
      const result = await runBoneoCollection(
        goteborg,
        deps(impl),
        keepAll,
        memory,
      );
      expect(result.stopped).toBe('http-403');
      expect(memory.details).toEqual({ '1': remembered(8 * DAY) });
    });

    it('does not count remembered pages toward the 150 page cap', async () => {
      const memory = rememberedIds(100);
      const { impl, calls } = fakeFetch(
        boneoRobotsOr(serve(160, () => ({ body: BALCONY }))),
      );
      const result = await runBoneoCollection(
        goteborg,
        deps(impl),
        keepAll,
        memory,
      );
      expect(detailCalls(calls)).toHaveLength(60);
      expect(result).toMatchObject({
        detailRead: 60,
        detailCached: 100,
        detailSkipped: 0,
      });
      expect(Object.keys(memory.details)).toHaveLength(160);
    });

    it('does not count remembered pages toward the 250 request cap', async () => {
      const memory = rememberedIds(160);
      let id = 0;
      const { impl, calls } = fakeFetch(
        boneoRobotsOr((url) =>
          isDetail(url) ? { body: BALCONY } : { body: nextPage([++id], 500) },
        ),
      );
      const four = Array.from({ length: 4 }, (_v, index) => ({
        ...goteborg[0],
        id: `municipality-${index + 1}`,
      }));
      const result = await runBoneoCollection(
        four,
        deps(impl),
        keepAll,
        memory,
      );
      // Without the memory, 71 of these 160 listings would be skipped.
      expect(calls).toHaveLength(161);
      expect(result).toMatchObject({
        requestCount: 161,
        detailCached: 160,
        detailRead: 0,
        detailSkipped: 0,
      });
    });

    it('still skips a listing robots.txt disallows, remembered or not', async () => {
      const memory = rememberedIds(1);
      const { impl } = fakeFetch((url) =>
        url.endsWith('/robots.txt')
          ? {
              body: 'User-agent: *\nAllow: /\nDisallow: /bostad/\n',
              type: 'text/plain',
            }
          : serve(1, () => ({ body: BALCONY }))(url),
      );
      const result = await runBoneoCollection(
        goteborg,
        deps(impl),
        keepAll,
        memory,
      );
      expect(result).toMatchObject({ detailCached: 0, detailSkipped: 1 });
      expect(result.observations[0].facts.outdoor).toBeNull();
    });

    it('saves listing ids and the listing page facts only', async () => {
      const memory = memoryOf({});
      const { impl } = fakeFetch(
        boneoRobotsOr(
          serve(3, () => ({ body: boneoFixture('detail-glazed.html') })),
        ),
      );
      await runBoneoCollection(goteborg, deps(impl), keepAll, memory);
      const path = join(mkdtempSync(join(tmpdir(), 'hs-saved-')), 'c.json');
      saveMemory(path, memory, NOW);
      const text = readFileSync(path, 'utf8');
      const saved = JSON.parse(text);
      expect(Object.keys(saved)).toEqual([
        'version',
        'lastLiveRunAt',
        'details',
      ]);
      expect(Object.keys(saved.details)).toEqual(['1', '2', '3']);
      for (const entry of Object.values<object>(saved.details))
        expect(Object.keys(entry)).toEqual([
          'outdoor',
          'glazed',
          'groundFloor',
          'readAt',
        ]);
      for (const value of ['Fixturegatan', 'fixture-', 'https', 'boneo'])
        expect(text).not.toContain(value);
    });
  });
});
