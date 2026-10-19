import {
  hhHome,
  hhList,
  numbered,
} from '@house-scanner-tools/husman-hagberg-test-pages';
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
  husmanHagbergAdapter,
} from '@house-scanner-tools/source-adapters';
import {
  approvedPolicy,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';
import { assertSourceAllowed } from '@/features/house-scanner/utils/source-policy';

const LIST =
  'https://api.husmanhagberg.se/object/api/objects?ps=200&regX=G%C3%B6teborg';
// The shape the real robots.txt has.
const ROBOTS =
  'User-agent: *\nAllow: /\nSitemap: https://www.husmanhagberg.se/sitemap.xml';
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
) => runCollection(husmanHagbergAdapter, ...args);
const site =
  (homes: unknown[], count?: number) =>
  (url: string): Reply =>
    url.endsWith('/robots.txt')
      ? robotsReply
      : { body: hhList(homes, count), type: 'application/json' };

describe('Husman Hagberg guarded run', () => {
  it('makes exactly two requests, robots.txt and the list, with the honest user agent and a JSON Accept header', async () => {
    const { impl, calls } = fakeFetch(site([numbered(1), numbered(2)]));
    const result = await run(goteborg, deps(impl));
    expect(calls.map((call) => call.url)).toEqual([
      'https://www.husmanhagberg.se/robots.txt',
      LIST,
    ]);
    for (const { init } of calls)
      expect(init).toMatchObject({
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
      });
    for (const { init } of calls)
      expect(init.headers).toMatchObject({
        'user-agent': USER_AGENT,
        accept: expect.stringContaining('application/json'),
      });
    expect(result.partitions[0]).toMatchObject({
      status: 'read',
      pages: 1,
      observations: 2,
      total: 2,
    });
  });

  it('reads no home page even when every home is kept', async () => {
    const { impl, calls } = fakeFetch(site([numbered(1), numbered(2)]));
    const result = await run(goteborg, deps(impl), (all) => all);
    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({
      detailRead: 0,
      detailFailed: 0,
      detailSkipped: 0,
      stopped: null,
    });
    expect(result.observations[0].facts.lift).toBeNull();
  });

  it('keeps only the partition municipality from a list that matched by text', async () => {
    const { impl } = fakeFetch(
      site([
        numbered(1),
        numbered(2, {
          address: { ...hhHome().address, municipality: 'Härryda' },
        }),
      ]),
    );
    const result = await run(goteborg, deps(impl));
    expect(result.observations.map((o) => o.sourceListingId)).toEqual([
      'OBJ0000000000000000001',
    ]);
    expect(result.partitions[0]).toMatchObject({ observations: 1, skipped: 1 });
  });

  it('publishes a truncated partition, not a complete one, when the list is shorter than its count', async () => {
    const { impl, calls } = fakeFetch(site([numbered(1)], 450));
    const result = await run(goteborg, deps(impl));
    expect(calls).toHaveLength(2);
    expect(result.partitions[0]).toMatchObject({
      status: 'truncated',
      reason: 'empty-page-before-total',
      total: 450,
    });
  });

  it('treats an answer that is not the list as failed coverage and stops the run', async () => {
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

  it('does not follow a redirect', async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.endsWith('/robots.txt') ? robotsReply : { status: 301, body: '' },
    );
    const result = await run(goteborg, deps(impl));
    expect(result.stopped).toBe('http-non-200');
    expect(calls).toHaveLength(2);
  });

  it('supports Göteborg and nothing else', () => {
    expect(
      husmanHagbergAdapter.partitionUrl({
        id: 'x',
        municipality: ' GÖTEBORG ',
        propertyTypes: ['apartment'],
      }),
    ).toBe(LIST);
    for (const municipality of ['Mölndal', 'Lerum'])
      expect(
        husmanHagbergAdapter.partitionUrl({
          id: 'x',
          municipality,
          propertyTypes: ['apartment'],
        }),
      ).toEqual({ unsupported: 'municipality-path-unproven' });
  });

  it('allows the list under the real robots shape, and refuses when the site disallows it', async () => {
    expect(
      robotsAllows(
        parseRobots(ROBOTS),
        '/object/api/objects?ps=200&regX=G%C3%B6teborg',
      ),
    ).toBe(true);
    const closed = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? { body: 'User-agent: *\nDisallow: /object/', type: 'text/plain' }
        : { body: '' },
    );
    const result = await run(goteborg, deps(closed.impl));
    expect(result.stopped).toBe('robots-disallow');
    expect(closed.calls).toHaveLength(1);
  });

  it('keeps the public page address on the observation', async () => {
    const { impl } = fakeFetch(site([hhHome()]));
    const result = await run(goteborg, deps(impl));
    expect(result.observations[0].sourceUrl).toBe(
      'https://www.husmanhagberg.se/estate/OBJ0000000000000000001/',
    );
  });
});

function husmanHagberg() {
  const found = sourceRegistry().find(
    (e) => e.policy.sourceId === 'husman-hagberg',
  );
  if (!found) throw new Error('husman-hagberg missing');
  return found;
}

describe('Husman Hagberg registry entry', () => {
  it('registers a pending source with an honest policy and the right hosts', () => {
    const { policy, executor } = husmanHagberg();
    expect(executor).toBe('husman-hagberg-personal-read');
    expect(policy).toMatchObject({
      sourceId: 'husman-hagberg',
      status: 'pending',
      automatedCollection: false,
      privateDisplay: false,
      listingOrigins: ['https://www.husmanhagberg.se'],
      imageOrigins: ['https://media.husmanhagberg.se'],
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
      ]),
    );
    // The list does not carry these, so the policy does not allow them.
    for (const left of ['glazed', 'outdoor', 'lift'])
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
      'husman-hagberg',
      new Date('2026-10-20T00:00:00Z'),
    );
    expect(approved).toMatchObject({ status: 'approved' });
    expect(() =>
      assertSourceAllowed(approved, new Date('2026-10-21T00:00:00Z')),
    ).not.toThrow();
  });

  it('is found by its capability and refused for another host, photo origin or executor', () => {
    expect(adapterFor(husmanHagberg())).toBe(husmanHagbergAdapter);
    const wrongHost = structuredClone(husmanHagberg());
    wrongHost.policy.listingOrigins = ['https://www.example.invalid'];
    expect(() => adapterFor(wrongHost)).toThrow('No permitted executor');
    const photos = structuredClone(husmanHagberg());
    photos.policy.imageOrigins = ['https://imagedelivery.net'];
    expect(() => adapterFor(photos)).toThrow('No permitted executor');
    const other = structuredClone(husmanHagberg());
    other.executor = 'boneo-personal-read';
    expect(() => adapterFor(other)).toThrow('No permitted executor');
    const boneo = sourceRegistry().find((e) => e.policy.sourceId === 'boneo');
    if (!boneo) throw new Error('boneo missing');
    expect(adapterFor(boneo)).toBe(boneoAdapter);
  });
});
