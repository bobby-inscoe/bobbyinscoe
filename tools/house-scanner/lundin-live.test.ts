import { runCollection, USER_AGENT } from '@house-scanner-tools/live-reader';
import {
  deps,
  fakeFetch,
  type Reply,
} from '@house-scanner-tools/live-test-helpers';
import {
  lundinHome,
  lundinList,
  numbered,
} from '@house-scanner-tools/lundin-test-pages';
import { parseRobots, robotsAllows } from '@house-scanner-tools/robots';
import {
  adapterFor,
  boneoAdapter,
  lundinAdapter,
} from '@house-scanner-tools/source-adapters';
import {
  approvedPolicy,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';
import { assertSourceAllowed } from '@/features/house-scanner/utils/source-policy';

const LIST = 'https://www.lundin.se/api/list?id=1';
// The shape the real robots.txt has.
const ROBOTS = 'User-agent: *\nDisallow: /file/\nDisallow: /fil/pdf/';
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
) => runCollection(lundinAdapter, ...args);
const site =
  (homes: unknown[]) =>
  (url: string): Reply =>
    url.endsWith('/robots.txt') ? robotsReply : { body: lundinList(homes) };

describe('Lundin guarded run', () => {
  it('makes exactly two requests, robots.txt and the list, with the honest user agent and a JSON Accept header', async () => {
    const { impl, calls } = fakeFetch(site([numbered(1), numbered(2)]));
    const result = await run(goteborg, deps(impl));
    expect(calls.map((call) => call.url)).toEqual([
      'https://www.lundin.se/robots.txt',
      LIST,
    ]);
    for (const { init } of calls)
      expect(init.headers).toMatchObject({
        'user-agent': USER_AGENT,
        accept: expect.stringContaining('application/json'),
      });
    expect(result.partitions[0]).toMatchObject({
      status: 'read',
      pages: 1,
      observations: 2,
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

  it('keeps only the partition municipality from a list that covers the whole region', async () => {
    const { impl } = fakeFetch(
      site([
        numbered(1),
        numbered(2, { City: 'Mölndal', ParentLocation: '' }),
        numbered(3, {
          City: 'Kungsbacka',
          ParentLocation: 'Kungsbacka Kommun',
        }),
      ]),
    );
    const result = await run(goteborg, deps(impl));
    expect(result.observations.map((o) => o.sourceListingId)).toEqual([
      'OBJ0000000000000000001',
    ]);
    expect(result.partitions[0]).toMatchObject({ observations: 1, skipped: 2 });
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

  it('supports Göteborg and Mölndal and nothing else', () => {
    for (const municipality of [' GÖTEBORG ', 'Mölndal'])
      expect(
        lundinAdapter.partitionUrl({
          id: 'x',
          municipality,
          propertyTypes: ['apartment'],
        }),
      ).toBe(LIST);
    expect(
      lundinAdapter.partitionUrl({
        id: 'x',
        municipality: 'Lerum',
        propertyTypes: ['apartment'],
      }),
    ).toEqual({ unsupported: 'municipality-path-unproven' });
  });

  it('allows the list under the real robots shape, and refuses when the site disallows it', async () => {
    expect(robotsAllows(parseRobots(ROBOTS), '/api/list?id=1')).toBe(true);
    const closed = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? { body: 'User-agent: *\nDisallow: /api/', type: 'text/plain' }
        : { body: '' },
    );
    const result = await run(goteborg, deps(closed.impl));
    expect(result.stopped).toBe('robots-disallow');
    expect(closed.calls).toHaveLength(1);
  });

  it('keeps the public page address on the observation', async () => {
    const { impl } = fakeFetch(site([lundinHome()]));
    const result = await run(goteborg, deps(impl));
    expect(result.observations[0].sourceUrl).toBe(
      'https://www.lundin.se/beskrivning/OBJ0000000000000000001/exempelgatan-1',
    );
  });
});

function lundin() {
  const found = sourceRegistry().find((e) => e.policy.sourceId === 'lundin');
  if (!found) throw new Error('lundin missing');
  return found;
}

describe('Lundin registry entry', () => {
  it('registers a pending source with an honest policy and the right hosts', () => {
    const { policy, executor } = lundin();
    expect(executor).toBe('lundin-personal-read');
    expect(policy).toMatchObject({
      sourceId: 'lundin',
      status: 'pending',
      automatedCollection: false,
      privateDisplay: false,
      listingOrigins: ['https://www.lundin.se'],
      imageOrigins: ['https://www.lundin.se'],
      imageDisplay: true,
      imageHotlink: true,
      retentionDays: 14,
    });
    expect(policy.rightsBasis).toContain('Permission unresolved');
    expect(policy.allowedFactFields).toEqual(
      expect.arrayContaining(['livingAreaM2', 'askingPriceSek', 'status']),
    );
    // The list does not carry these, so the policy does not allow them.
    for (const left of ['glazed', 'outdoor', 'lift', 'groundFloor'])
      expect(policy.allowedFactFields).not.toContain(left);
    expect(policy.capabilities.coverageGaps.join(' ')).toContain(
      'not a documented',
    );
    expect(() =>
      assertSourceAllowed(policy, new Date('2026-10-20T00:00:00Z')),
    ).toThrow();
  });

  it('yields a policy the owner can approve for 90 days', () => {
    const approved = approvedPolicy('lundin', new Date('2026-10-20T00:00:00Z'));
    expect(approved).toMatchObject({ status: 'approved' });
    expect(() =>
      assertSourceAllowed(approved, new Date('2026-10-21T00:00:00Z')),
    ).not.toThrow();
  });

  it('is found by its capability and refused for another host, photo origin or executor', () => {
    expect(adapterFor(lundin())).toBe(lundinAdapter);
    const wrongHost = structuredClone(lundin());
    wrongHost.policy.listingOrigins = ['https://www.example.invalid'];
    expect(() => adapterFor(wrongHost)).toThrow('No permitted executor');
    const photos = structuredClone(lundin());
    photos.policy.imageOrigins = ['https://imagedelivery.net'];
    expect(() => adapterFor(photos)).toThrow('No permitted executor');
    const other = structuredClone(lundin());
    other.executor = 'boneo-personal-read';
    expect(() => adapterFor(other)).toThrow('No permitted executor');
    const boneo = sourceRegistry().find((e) => e.policy.sourceId === 'boneo');
    if (!boneo) throw new Error('boneo missing');
    expect(adapterFor(boneo)).toBe(boneoAdapter);
  });
});
