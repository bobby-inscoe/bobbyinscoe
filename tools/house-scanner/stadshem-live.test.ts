import { runCollection, USER_AGENT } from '@house-scanner-tools/live-reader';
import {
  deps,
  fakeFetch,
  type Reply,
} from '@house-scanner-tools/live-test-helpers';
import { parseRobots, robotsAllows } from '@house-scanner-tools/robots';
import {
  adapterFor,
  boneoAdapter,
  stadshemAdapter,
} from '@house-scanner-tools/source-adapters';
import {
  approvedPolicy,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import { estate, list, record } from '@house-scanner-tools/stadshem-test-pages';
import { describe, expect, it } from 'vitest';
import { assertSourceAllowed } from '@/features/house-scanner/utils/source-policy';

const API = 'https://stadshem.se/api/estates';
const QUERY =
  'per_page=100&orderby=published&order=desc&status[]=till-salu&status[]=snart-till-salu-kommande';
// The shape the real robots.txt has.
const ROBOTS =
  'User-agent: *\nAllow: *\nSitemap: https://stadshem.se/sitemap.xml';
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
) => runCollection(stadshemAdapter, ...args);

const home = (n: number) =>
  estate({
    id: `estate-OBJ00000000000000${String(n).padStart(2, '0')}-gata-${n}`,
    estateId: `OBJ00000000000000${String(n).padStart(2, '0')}`,
    address: { ...estate().address, streetAddress: `Gata ${n}` },
  });
const isRecord = (url: string) => /\/api\/estates\/OBJ/.test(url);

// `per` homes a page, `total` homes in all, served as the page number asks.
const site =
  (
    total: number,
    per: number,
    detail: () => Reply = () => ({ body: record() }),
  ) =>
  (url: string): Reply => {
    if (url.endsWith('/robots.txt')) return robotsReply;
    if (isRecord(url)) return detail();
    const pageNumber = Number(new URL(url).searchParams.get('page') ?? '1');
    const first = (pageNumber - 1) * per + 1;
    const last = Math.min(total, pageNumber * per);
    const homes = Array.from(
      { length: Math.max(0, last - first + 1) },
      (_v, i) => home(first + i),
    );
    return {
      body: list(homes, {
        page: pageNumber,
        numPages: Math.ceil(total / per),
        total,
      }),
    };
  };

describe('Stadshem guarded run', () => {
  it('sends the honest user agent and a JSON Accept header on every request', async () => {
    const { impl, calls } = fakeFetch(site(2, 100));
    await run(goteborg, deps(impl));
    expect(calls).toHaveLength(2);
    for (const { init } of calls)
      expect(init.headers).toMatchObject({
        'user-agent': USER_AGENT,
        accept: expect.stringContaining('application/json'),
      });
  });

  it('asks for every home in one request and follows the page count only when there is more', async () => {
    const { impl, calls } = fakeFetch(site(5, 2));
    const result = await run(goteborg, deps(impl));
    expect(calls.map((call) => call.url)).toEqual([
      'https://stadshem.se/robots.txt',
      `${API}?${QUERY}&page=1`,
      `${API}?${QUERY}&page=2`,
      `${API}?${QUERY}&page=3`,
    ]);
    expect(result.partitions[0]).toMatchObject({
      status: 'read',
      pages: 3,
      observations: 5,
    });
  });

  it('stops and reports truncation on an empty page before the last page', async () => {
    const complete = site(10, 4);
    const { impl } = fakeFetch((url) =>
      url.includes('page=2')
        ? { body: list([], { page: 2, numPages: 3, total: 10 }) }
        : complete(url),
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
      reason: 'invalid-embedded-data',
    });
    expect(result.stopped).toBe('invalid-embedded-data');
  });

  it.each([403, 429])('stops at once on %i without a retry', async (status) => {
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith('/robots.txt') ? robotsReply : { status, body: '' },
    );
    const result = await run(goteborg, deps(impl));
    expect(result.stopped).toBe(`http-${status}`);
    expect(calls).toHaveLength(2);
  });

  it('keeps only the partition municipality from a list that covers the country', async () => {
    const stockholm = estate({
      id: 'estate-OBJ0000000000000099-gata-99',
      estateId: 'OBJ0000000000000099',
      address: { ...estate().address, municipality: 'Stockholm' },
    });
    const { impl } = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? robotsReply
        : { body: list([home(1), stockholm, home(2)]) },
    );
    const result = await run(goteborg, deps(impl));
    expect(result.observations.map((o) => o.sourceListingId)).toEqual([
      'OBJ0000000000000001',
      'OBJ0000000000000002',
    ]);
    expect(result.partitions[0]).toMatchObject({ observations: 2, skipped: 1 });
  });

  it('supports only the municipality it knows', () => {
    expect(
      stadshemAdapter.partitionUrl({
        id: 'x',
        municipality: ' GÖTEBORG ',
        propertyTypes: ['apartment'],
      }),
    ).toBe(`${API}?${QUERY}&page=1`);
    expect(
      stadshemAdapter.partitionUrl({
        id: 'x',
        municipality: 'Mölndal',
        propertyTypes: ['apartment'],
      }),
    ).toEqual({ unsupported: 'municipality-path-unproven' });
  });

  it('allows the list and record paths under the real robots shape, and refuses when the site disallows them', async () => {
    const rules = parseRobots(ROBOTS);
    for (const path of [
      `/api/estates?${QUERY}&page=2`,
      '/api/estates/OBJ0000000000000001',
    ])
      expect(robotsAllows(rules, path)).toBe(true);
    const closed = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? { body: 'User-agent: *\nDisallow: /api/', type: 'text/plain' }
        : { body: '' },
    );
    const result = await run(goteborg, deps(closed.impl));
    expect(result.stopped).toBe('robots-disallow');
    expect(closed.calls).toHaveLength(1);
  });

  it('reads each kept home record from the API address, while the observation keeps the public page address', async () => {
    const { impl, calls } = fakeFetch(site(2, 100));
    const result = await run(goteborg, deps(impl), (all) => all);
    expect(
      calls.filter((call) => isRecord(call.url)).map((c) => c.url),
    ).toEqual([`${API}/OBJ0000000000000001`, `${API}/OBJ0000000000000002`]);
    expect(result).toMatchObject({ detailRead: 2, detailFailed: 0 });
    const [first] = result.observations;
    expect(first.sourceUrl).toBe(
      'https://stadshem.se/objekt/OBJ0000000000000001-gata-1',
    );
    expect(first.facts).toMatchObject({
      groundFloor: false,
      lift: true,
      tenure: 'cooperative',
    });
    // The list gave the position and the photo; the record does not replace them.
    expect(first.coordinates?.source).toBe('stadshem-estates');
    expect(first.photo).not.toBeNull();
  });

  it('leaves floor and lift unknown when a record fails, without stopping the run', async () => {
    const { impl } = fakeFetch(site(2, 100, () => ({ body: 'nej' })));
    const result = await run(goteborg, deps(impl), (all) => all);
    expect(result).toMatchObject({
      detailRead: 0,
      detailFailed: 2,
      stopped: null,
    });
    expect(result.observations[0].facts.lift).toBeNull();
  });
});

function stadshem() {
  const found = sourceRegistry().find((e) => e.policy.sourceId === 'stadshem');
  if (!found) throw new Error('stadshem missing');
  return found;
}

describe('Stadshem registry entry', () => {
  it('registers a pending source with an honest policy and the right hosts', () => {
    const { policy, executor } = stadshem();
    expect(executor).toBe('stadshem-personal-read');
    expect(policy).toMatchObject({
      sourceId: 'stadshem',
      status: 'pending',
      automatedCollection: false,
      privateDisplay: false,
      listingOrigins: ['https://stadshem.se'],
      imageOrigins: ['https://storage.googleapis.com'],
      imageDisplay: true,
      imageHotlink: true,
      retentionDays: 14,
    });
    expect(policy.rightsBasis).toContain('Permission unresolved');
    expect(policy.allowedFactFields).toEqual(
      expect.arrayContaining([
        'livingAreaM2',
        'askingPriceSek',
        'status',
        'groundFloor',
        'lift',
        'tenure',
      ]),
    );
    for (const left of ['glazed', 'outdoor'])
      expect(policy.allowedFactFields).not.toContain(left);
    expect(policy.capabilities.coverageGaps.join(' ')).toContain(
      'not a documented',
    );
    expect(() =>
      assertSourceAllowed(policy, new Date('2026-10-20T00:00:00Z')),
    ).toThrow();
  });

  it('yields a policy the owner can approve for 90 days', () => {
    const approved = approvedPolicy(
      'stadshem',
      new Date('2026-10-20T00:00:00Z'),
    );
    expect(approved).toMatchObject({ status: 'approved' });
    expect(() =>
      assertSourceAllowed(approved, new Date('2026-10-21T00:00:00Z')),
    ).not.toThrow();
  });

  it('is found by its capability and refused for another host, photo origin or executor', () => {
    expect(adapterFor(stadshem())).toBe(stadshemAdapter);
    const wrongHost = structuredClone(stadshem());
    wrongHost.policy.listingOrigins = ['https://www.example.invalid'];
    expect(() => adapterFor(wrongHost)).toThrow('No permitted executor');
    const photos = structuredClone(stadshem());
    photos.policy.imageOrigins = ['https://stadshem.se'];
    expect(() => adapterFor(photos)).toThrow('No permitted executor');
    const other = structuredClone(stadshem());
    other.executor = 'boneo-personal-read';
    expect(() => adapterFor(other)).toThrow('No permitted executor');
    const boneo = sourceRegistry().find((e) => e.policy.sourceId === 'boneo');
    if (!boneo) throw new Error('boneo missing');
    expect(adapterFor(boneo)).toBe(boneoAdapter);
  });

  it('leaves the sources nobody reads without an executor', () => {
    for (const id of ['alvhem', 'fastighetsbyran', 'booli', 'hemnet', 'norban'])
      expect(
        sourceRegistry().find((e) => e.policy.sourceId === id)?.executor,
      ).toBe('none');
  });
});
