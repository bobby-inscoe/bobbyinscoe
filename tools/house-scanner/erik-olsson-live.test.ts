import {
  type CardInput,
  home,
  IMAGE_ACCOUNT,
  listingPage,
  PHOTO_ID,
  search,
} from '@house-scanner-tools/erik-olsson-test-pages';
import { runCollection, USER_AGENT } from '@house-scanner-tools/live-reader';
import { assertAdapterOutput } from '@house-scanner-tools/live-run';
import {
  deps,
  fakeFetch,
  type Reply,
} from '@house-scanner-tools/live-test-helpers';
import { parseRobots, robotsAllows } from '@house-scanner-tools/robots';
import {
  adapterFor,
  boneoAdapter,
  erikOlssonAdapter,
} from '@house-scanner-tools/source-adapters';
import {
  approvedPolicy,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';
import { assertSourceAllowed } from '@/features/house-scanner/utils/source-policy';

const BASE = '/municipalities/goteborg-166?tab=homes';
// The rules the real robots.txt carries, in the shapes it uses.
const ROBOTS = [
  'User-Agent: *',
  'Allow: /',
  'Disallow: /dashboard/*',
  'Disallow: /engine/*',
  'Disallow: /api/*',
  'Disallow: /password',
  'Disallow: /beta',
].join('\n');
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
) => runCollection(erikOlssonAdapter, ...args);

const cardFor = (id: number): CardInput => ({
  slug: `Lagenhet-2rum-Gata-${id}-Omrade-Goteborg-kommun-${9_100_000 + id}`,
  lines: [`Gata ${id}`, 'Lägenhet, Område, Göteborg', '2 rum • 60 m²'],
});
const isListing = (url: string) => new URL(url).pathname.startsWith('/homes/');
const robotsReply: Reply = { body: ROBOTS, type: 'text/plain' };

// `per` cards a page from id 1, `total` homes in all.
const site =
  (
    total: number,
    per: number,
    detail: () => Reply = () => ({ body: listingPage(home()) }),
  ) =>
  (url: string): Reply => {
    if (url.endsWith('/robots.txt')) return robotsReply;
    if (isListing(url)) return detail();
    const page = Number(new URL(url).searchParams.get('page') ?? '1');
    const first = (page - 1) * per + 1;
    const last = Math.min(total, page * per);
    const ids = Array.from(
      { length: Math.max(0, last - first + 1) },
      (_v, i) => first + i,
    );
    return { body: search(ids.map(cardFor), total) };
  };

describe('Erik Olsson guarded run', () => {
  it('sends the honest user agent and ordinary Accept headers on every request', async () => {
    const { impl, calls } = fakeFetch(site(2, 2));
    await run(goteborg, deps(impl));
    expect(calls).toHaveLength(2);
    for (const { init } of calls)
      expect(init.headers).toMatchObject({
        'user-agent': USER_AGENT,
        accept: expect.stringContaining('text/html'),
      });
  });

  it('adds the page number to the existing query and reads until the total', async () => {
    const { impl, calls } = fakeFetch(site(5, 2));
    const result = await run(goteborg, deps(impl));
    expect(calls.map((call) => call.url)).toEqual([
      'https://www.erikolsson.se/robots.txt',
      `https://www.erikolsson.se${BASE}`,
      `https://www.erikolsson.se${BASE}&page=2`,
      `https://www.erikolsson.se${BASE}&page=3`,
    ]);
    expect(result.partitions[0]).toMatchObject({
      status: 'read',
      pages: 3,
      total: 5,
      observations: 5,
    });
  });

  it('stops and reports truncation on an empty page before the total', async () => {
    const complete = site(10, 4);
    const { impl } = fakeFetch((url) =>
      url.includes('page=3') ? { body: search([], 10) } : complete(url),
    );
    const result = await run(goteborg, deps(impl));
    expect(result.partitions[0]).toMatchObject({
      status: 'truncated',
      reason: 'empty-page-before-total',
    });
  });

  it('treats a page without cards as failed coverage and stops the run', async () => {
    const { impl } = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? robotsReply
        : {
            body: '<html><head><title>468 bostäder till salu i Göteborg</title></head><body>Laddar</body></html>',
          },
    );
    const result = await run(goteborg, deps(impl));
    expect(result.partitions[0]).toMatchObject({
      status: 'failed',
      reason: 'no-results-list',
    });
    expect(result.stopped).toBe('no-results-list');
  });

  it.each([403, 429])('stops at once on %i without a retry', async (status) => {
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith('/robots.txt') ? robotsReply : { status, body: '' },
    );
    const result = await run(goteborg, deps(impl));
    expect(result.stopped).toBe(`http-${status}`);
    expect(calls).toHaveLength(2);
  });

  it('supports only the municipality it knows, and any property type', () => {
    expect(
      erikOlssonAdapter.partitionUrl({
        id: 'x',
        municipality: ' GÖTEBORG ',
        propertyTypes: ['house'],
      }),
    ).toBe(`https://www.erikolsson.se${BASE}`);
    expect(
      erikOlssonAdapter.partitionUrl({
        id: 'x',
        municipality: 'Mölndal',
        propertyTypes: ['apartment'],
      }),
    ).toEqual({ unsupported: 'municipality-path-unproven' });
  });

  it('allows the search and listing paths and refuses the disallowed ones', async () => {
    const rules = parseRobots(ROBOTS);
    for (const path of [
      '/municipalities/goteborg-166?tab=homes&page=2',
      '/homes/Lagenhet-2rum-Gata-1-Omrade-Goteborg-kommun-9100001',
    ])
      expect(robotsAllows(rules, path)).toBe(true);
    for (const path of ['/api/homes', '/dashboard/x', '/engine/x', '/password'])
      expect(robotsAllows(rules, path)).toBe(false);
    const closed = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? {
            body: 'User-agent: *\nDisallow: /municipalities/',
            type: 'text/plain',
          }
        : { body: '' },
    );
    const result = await run(goteborg, deps(closed.impl));
    expect(result.stopped).toBe('robots-disallow');
    expect(closed.calls).toHaveLength(1);
  });

  it('reads the listing page of each kept home and merges its facts', async () => {
    const { impl, calls } = fakeFetch(site(2, 2));
    const result = await run(goteborg, deps(impl), (all) => all);
    expect(calls.filter((call) => isListing(call.url))).toHaveLength(2);
    expect(result).toMatchObject({ detailRead: 2, detailFailed: 0 });
    expect(result.observations[0].facts).toMatchObject({
      outdoor: 'balcony',
      lift: true,
      groundFloor: false,
      tenure: 'cooperative',
      status: 'available',
      askingPriceSek: 3_900_000,
    });
    // The title has a house number, so the broker's point is labelled address-level.
    expect(result.observations[0].coordinates).toMatchObject({
      latitude: 57.7,
      longitude: 11.95,
      precision: 'address',
      source: 'erik-olsson-listing-page',
    });
  });

  it('shows the first photo from the broker image host, hotlinked, for a week', async () => {
    const { impl } = fakeFetch(site(1, 1));
    const result = await run(goteborg, deps(impl), (all) => all);
    const [observation] = result.observations;
    expect(observation.photo).toMatchObject({
      url: `https://imagedelivery.net/${IMAGE_ACCOUNT}/${PHOTO_ID}/w=640,h=480,fit=cover,quality=80,format=auto`,
      attribution: 'Erik Olsson',
      displayAllowed: true,
      hotlinkAllowed: true,
      observedAt: observation.observedAt,
    });
    expect(
      Date.parse(observation.photo?.expiresAt ?? '') -
        Date.parse(observation.observedAt),
    ).toBe(7 * 24 * 60 * 60 * 1000);
    // The photo is not a fact: it never lands in the facts.
    expect(observation.facts).not.toHaveProperty('photoPath');
    assertAdapterOutput(erikOlsson().policy, observation);
  });

  it('leaves the photo off when a listing page names no image', async () => {
    const { impl } = fakeFetch(
      site(1, 1, () => ({ body: listingPage(home(), 3, false) })),
    );
    const result = await run(goteborg, deps(impl), (all) => all);
    expect(result.observations[0].photo).toBeNull();
  });

  it('leaves the extra facts unknown when a listing page fails, without stopping the run', async () => {
    const { impl } = fakeFetch(
      site(2, 2, () => ({ body: '<html>tom</html>' })),
    );
    const result = await run(goteborg, deps(impl), (all) => all);
    expect(result).toMatchObject({
      detailRead: 0,
      detailFailed: 2,
      stopped: null,
    });
    expect(result.observations[0].facts.outdoor).toBeNull();
  });
});

function erikOlsson() {
  const found = sourceRegistry().find(
    (e) => e.policy.sourceId === 'erik-olsson',
  );
  if (!found) throw new Error('erik-olsson missing');
  return found;
}

describe('Erik Olsson registry entry', () => {
  it('registers a pending source with an honest policy, hotlinked photos and the right hosts', () => {
    const { policy, executor } = erikOlsson();
    expect(executor).toBe('erik-olsson-personal-read');
    expect(policy).toMatchObject({
      sourceId: 'erik-olsson',
      status: 'pending',
      automatedCollection: false,
      privateDisplay: false,
      listingOrigins: ['https://www.erikolsson.se'],
      imageOrigins: ['https://imagedelivery.net'],
      imageDisplay: true,
      imageHotlink: true,
      retentionDays: 14,
    });
    expect(policy.rightsBasis).toContain('Permission unresolved');
    expect(policy.allowedFactFields).toEqual(
      expect.arrayContaining([
        'livingAreaM2',
        'askingPriceSek',
        'outdoor',
        'lift',
        'groundFloor',
      ]),
    );
    expect(policy.allowedFactFields).not.toContain('glazed');
    expect(policy.capabilities.coverageGaps.join(' ')).toContain('Underhand');
    expect(() =>
      assertSourceAllowed(policy, new Date('2026-10-20T00:00:00Z')),
    ).toThrow();
  });

  it('yields a policy the owner can approve for 90 days', () => {
    const approved = approvedPolicy(
      'erik-olsson',
      new Date('2026-10-20T00:00:00Z'),
    );
    expect(approved).toMatchObject({
      status: 'approved',
      automatedCollection: true,
    });
    expect(() =>
      assertSourceAllowed(approved, new Date('2026-10-21T00:00:00Z')),
    ).not.toThrow();
  });

  it('is found by its capability and refused for another host, photo origin or executor', () => {
    expect(adapterFor(erikOlsson())).toBe(erikOlssonAdapter);
    const wrongHost = structuredClone(erikOlsson());
    wrongHost.policy.listingOrigins = ['https://www.example.invalid'];
    expect(() => adapterFor(wrongHost)).toThrow('No permitted executor');
    const photos = structuredClone(erikOlsson());
    photos.policy.imageOrigins = ['https://www.erikolsson.se'];
    expect(() => adapterFor(photos)).toThrow('No permitted executor');
    const noPhotos = structuredClone(erikOlsson());
    noPhotos.policy.imageOrigins = [];
    expect(() => adapterFor(noPhotos)).toThrow('No permitted executor');
    const other = structuredClone(erikOlsson());
    other.executor = 'boneo-personal-read';
    expect(() => adapterFor(other)).toThrow('No permitted executor');
    const boneo = sourceRegistry().find((e) => e.policy.sourceId === 'boneo');
    if (!boneo) throw new Error('boneo missing');
    expect(adapterFor(boneo)).toBe(boneoAdapter);
  });

  it('leaves the other candidates without an executor', () => {
    for (const id of ['alvhem', 'fastighetsbyran', 'booli', 'hemnet', 'norban'])
      expect(
        sourceRegistry().find((e) => e.policy.sourceId === id)?.executor,
      ).toBe('none');
  });
});
