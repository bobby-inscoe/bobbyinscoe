import { runCollection, USER_AGENT } from '@house-scanner-tools/live-reader';
import {
  deps,
  fakeFetch,
  type Reply,
} from '@house-scanner-tools/live-test-helpers';
import { parseRobots, robotsAllows } from '@house-scanner-tools/robots';
import { svenskfastAdapter } from '@house-scanner-tools/source-adapters';
import { sourceRegistry } from '@house-scanner-tools/source-registry';
import { home, list, pathOf } from '@house-scanner-tools/svenskfast-test-pages';
import { describe, expect, it } from 'vitest';
import { assertSourceAllowed } from '@/features/house-scanner/utils/source-policy';

const BASE = 'https://www.svenskfast.se/bostad/vastra-gotaland/goteborg/';
// The shape the real robots.txt has.
const ROBOTS = [
  'User-agent: *',
  'Disallow: /en/',
  'Allow: /en/spain/',
  'Allow: /',
  'Disallow: /*?t=*',
  'Disallow: /*?maxp=*',
  'Disallow: /*?minp=*',
  'Disallow: /resurs/dokument/',
].join('\n');
const robotsReply: Reply = { body: ROBOTS, type: 'text/plain' };
const goteborg = [
  {
    id: 'municipality-1',
    municipality: 'Göteborg',
    propertyTypes: ['apartment' as const, 'house' as const],
  },
];
const run = (
  ...args: Parameters<typeof runCollection> extends [unknown, ...infer Rest]
    ? Rest
    : never
) => runCollection(svenskfastAdapter, ...args);

const isHome = (url: string) => /\/\d{4,9}\/$/.test(new URL(url).pathname);
// `per` homes a page, `total` homes in all, served as the page number asks.
const site =
  (
    total: number,
    per: number,
    detail: () => Reply = () => ({ body: home() }),
  ) =>
  (url: string): Reply => {
    if (url.endsWith('/robots.txt')) return robotsReply;
    if (isHome(url)) return detail();
    const pageNumber = Number(new URL(url).searchParams.get('p') ?? '1');
    const first = (pageNumber - 1) * per + 1;
    const last = Math.min(total, pageNumber * per);
    const cards = Array.from(
      { length: Math.max(0, last - first + 1) },
      (_v, i) => ({
        id: 400_000 + first + i,
        street: `Gata ${first + i}`,
        path: pathOf({ id: 400_000 + first + i, street: `gata-${first + i}` }),
      }),
    );
    return { body: list(cards, total) };
  };

describe('Svensk Fastighetsförmedling guarded run', () => {
  it('sends the honest user agent and an HTML Accept header on every request', async () => {
    const { impl, calls } = fakeFetch(site(2, 35));
    await run(goteborg, deps(impl));
    expect(calls).toHaveLength(2);
    for (const { init } of calls)
      expect(init.headers).toMatchObject({
        'user-agent': USER_AGENT,
        accept: expect.stringContaining('text/html'),
      });
  });

  it('reads the first page as asked, then ?p=N until the total is reached', async () => {
    const { impl, calls } = fakeFetch(site(5, 2));
    const result = await run(goteborg, deps(impl));
    expect(calls.map((call) => call.url)).toEqual([
      'https://www.svenskfast.se/robots.txt',
      BASE,
      `${BASE}?p=2`,
      `${BASE}?p=3`,
    ]);
    expect(result.partitions[0]).toMatchObject({
      status: 'read',
      pages: 3,
      observations: 5,
      total: 5,
    });
  });

  it('stops and reports truncation on an empty page before the total', async () => {
    const complete = site(10, 4);
    const { impl } = fakeFetch((url) =>
      url.includes('p=2') ? { body: list([], 10) } : complete(url),
    );
    const result = await run(goteborg, deps(impl));
    expect(result.partitions[0]).toMatchObject({
      status: 'truncated',
      reason: 'empty-page-before-total',
    });
  });

  it('treats a page that is not the list as failed coverage and stops the run', async () => {
    const { impl } = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? robotsReply
        : { body: '<html>underhåll</html>' },
    );
    const result = await run(goteborg, deps(impl));
    expect(result.partitions[0]).toMatchObject({
      status: 'failed',
      reason: 'no-embedded-data',
    });
    expect(result.stopped).toBe('no-embedded-data');
  });

  it('supports only the municipality it knows', () => {
    expect(
      svenskfastAdapter.partitionUrl({
        id: 'x',
        municipality: ' GÖTEBORG ',
        propertyTypes: ['apartment'],
      }),
    ).toBe(BASE);
    expect(
      svenskfastAdapter.partitionUrl({
        id: 'x',
        municipality: 'Mölndal',
        propertyTypes: ['apartment'],
      }),
    ).toEqual({ unsupported: 'municipality-path-unproven' });
  });

  it('allows the list, paging and home paths under the real robots shape, and refuses a disallowed query', async () => {
    const rules = parseRobots(ROBOTS);
    for (const path of [
      '/bostad/vastra-gotaland/goteborg/',
      '/bostad/vastra-gotaland/goteborg/?p=2',
      pathOf(),
    ])
      expect(robotsAllows(rules, path)).toBe(true);
    for (const path of [
      '/bostad/vastra-gotaland/goteborg/?minp=1000000',
      '/bostad/vastra-gotaland/goteborg/?t=1',
      '/en/anything',
    ])
      expect(robotsAllows(rules, path)).toBe(false);
    const closed = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? { body: 'User-agent: *\nDisallow: /bostad/', type: 'text/plain' }
        : { body: '' },
    );
    const result = await run(goteborg, deps(closed.impl));
    expect(result.stopped).toBe('robots-disallow');
    expect(closed.calls).toHaveLength(1);
  });

  it('reads each kept home page at its public address and applies price, fee, lift, viewings and position', async () => {
    const { impl, calls } = fakeFetch(
      site(2, 35, () => ({
        body: home({
          viewings: [
            {
              day: 28,
              month: 'okt',
              weekday: 'Tis',
              from: '17:00',
              to: '17:30',
            },
          ],
        }),
      })),
    );
    const result = await run(goteborg, deps(impl), (all) => all);
    expect(calls.filter((call) => isHome(call.url)).map((c) => c.url)).toEqual([
      `https://www.svenskfast.se${pathOf({ id: 400_001, street: 'gata-1' })}`,
      `https://www.svenskfast.se${pathOf({ id: 400_002, street: 'gata-2' })}`,
    ]);
    expect(result).toMatchObject({ detailRead: 2, detailFailed: 0 });
    const [first] = result.observations;
    expect(first.facts).toMatchObject({
      askingPriceSek: 3_995_000,
      baseFeeSek: 4102,
      lift: true,
      groundFloor: false,
    });
    expect(first.coordinates).toMatchObject({
      latitude: 57.70198,
      source: 'svenskfast-home-page',
      precision: 'address',
    });
    // The fake clock is 9 October 2025, when 28 October is a Tuesday (winter time).
    expect(first.viewings).toEqual([
      {
        startsAt: '2025-10-28T16:00:00.000Z',
        endsAt: '2025-10-28T16:30:00.000Z',
      },
    ]);
    expect(first.photo).not.toBeNull();
  });

  it('leaves the home page facts unknown when a page fails, without stopping the run', async () => {
    const { impl } = fakeFetch(site(2, 35, () => ({ body: 'nej' })));
    const result = await run(goteborg, deps(impl), (all) => all);
    expect(result).toMatchObject({
      detailRead: 0,
      detailFailed: 2,
      stopped: null,
    });
    expect(result.observations[0].facts.askingPriceSek).toBeNull();
  });
});

function svenskfast() {
  const found = sourceRegistry().find(
    (e) => e.policy.sourceId === 'svenskfast',
  );
  if (!found) throw new Error('svenskfast missing');
  return found;
}

describe('Svensk Fastighetsförmedling registry entry', () => {
  it('registers a pending source with an honest policy and the right hosts', () => {
    const { policy, executor } = svenskfast();
    expect(executor).toBe('svenskfast-personal-read');
    expect(policy).toMatchObject({
      sourceId: 'svenskfast',
      status: 'pending',
      viewings: true,
      automatedCollection: false,
      privateDisplay: false,
      listingOrigins: ['https://www.svenskfast.se'],
      imageOrigins: ['https://i.sfcdn.se'],
      imageDisplay: true,
      imageHotlink: true,
      retentionDays: 14,
      capabilities: { pagination: true },
    });
    expect(policy.rightsBasis).toContain('Permission unresolved');
    expect(policy.allowedFactFields).toEqual(
      expect.arrayContaining([
        'askingPriceSek',
        'baseFeeSek',
        'groundFloor',
        'lift',
        'status',
      ]),
    );
    for (const left of ['glazed', 'outdoor'])
      expect(policy.allowedFactFields).not.toContain(left);
    expect(
      policy.capabilities.coverageGaps.every((gap) => gap.length <= 300),
    ).toBe(true);
    expect(() =>
      assertSourceAllowed(policy, new Date('2026-10-20T00:00:00Z')),
    ).toThrow();
  });
});
