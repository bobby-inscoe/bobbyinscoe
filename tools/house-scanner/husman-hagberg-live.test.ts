import {
  estateImage,
  estatePage,
  hhHome,
  hhList,
  media,
  numbered,
} from '@house-scanner-tools/husman-hagberg-test-pages';
import { runCollection, USER_AGENT } from '@house-scanner-tools/live-reader';
import { assertAdapterOutput } from '@house-scanner-tools/live-run';
import {
  deps,
  fakeFetch,
  type Reply,
} from '@house-scanner-tools/live-test-helpers';
import { parseRobots, robotsAllows } from '@house-scanner-tools/robots';
import { emptyMemory } from '@house-scanner-tools/run-memory';
import { husmanHagbergAdapter } from '@house-scanner-tools/source-adapters';
import { sourceRegistry } from '@house-scanner-tools/source-registry';
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
  it('makes two requests, robots.txt and the list, when no home is kept, with the honest user agent and a JSON Accept header', async () => {
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

  it('reads the estate page of each kept home once for its gallery, and reuses it from memory', async () => {
    const page = estatePage(
      ['MEDP1', 'MEDP2', 'MEDP3', 'MEDP4', 'MEDP5'].map((id) =>
        estateImage(id),
      ),
      [estateImage('MEDPLAN1', 'Planritningar')],
    );
    const estate =
      'https://www.husmanhagberg.se/estate/OBJ0000000000000000001/';
    const reply = (url: string): Reply =>
      url === estate ? { body: page } : site([numbered(1)])(url);
    const expected = {
      photo: { url: media('MEDP1'), attribution: 'Husman Hagberg' },
      morePhotos: ['MEDP2', 'MEDP3', 'MEDP4'].map((id) => ({ url: media(id) })),
      floorPlan: { url: media('MEDPLAN1', '1410x940') },
    };
    const memory = emptyMemory();
    const first = fakeFetch(reply);
    const read = await run(goteborg, deps(first.impl), (all) => all, memory);
    expect(first.calls.map((call) => call.url)).toEqual([
      'https://www.husmanhagberg.se/robots.txt',
      LIST,
      estate,
    ]);
    expect(read).toMatchObject({ detailRead: 1, stopped: null });
    expect(read.observations[0]).toMatchObject(expected);
    assertAdapterOutput(husmanHagberg().policy, read.observations[0]);

    // An hour later, by the next run's clock, the remembered page is still fresh.
    for (const entry of Object.values(memory.details))
      entry.readAt = new Date(
        Date.parse(entry.readAt) - 3_600_000,
      ).toISOString();
    const again = fakeFetch(reply);
    const cached = await run(goteborg, deps(again.impl), (all) => all, memory);
    expect(again.calls).toHaveLength(2);
    expect(cached).toMatchObject({ detailCached: 1, detailRead: 0 });
    expect(cached.observations[0]).toMatchObject(expected);
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
});
