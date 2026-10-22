import {
  type LiveEvent,
  MAX_BODY_CHARS,
  runCollection,
  USER_AGENT,
} from '@house-scanner-tools/live-reader';
import { assertAdapterOutput } from '@house-scanner-tools/live-run';
import {
  deps,
  fakeFetch,
  type Reply,
} from '@house-scanner-tools/live-test-helpers';
import { LUNDIN_MAX_CHARS } from '@house-scanner-tools/lundin-parser';
import {
  lundinHome,
  lundinHomePage,
  lundinList,
  numbered,
} from '@house-scanner-tools/lundin-test-pages';
import { parseRobots, robotsAllows } from '@house-scanner-tools/robots';
import { emptyMemory } from '@house-scanner-tools/run-memory';
import {
  boneoAdapter,
  lundinAdapter,
} from '@house-scanner-tools/source-adapters';
import { sourceRegistry } from '@house-scanner-tools/source-registry';
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
    url.endsWith('/robots.txt')
      ? robotsReply
      : url.includes('/beskrivning/')
        ? { body: lundinHomePage() }
        : { body: lundinList(homes) };

describe('Lundin guarded run', () => {
  it('asks robots.txt, then the list, with the honest user agent and a JSON Accept header', async () => {
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

  it("reads each kept home's page once for its gallery, and a home reused from memory makes no page request but keeps it", async () => {
    const dc = (n: number, query: string) =>
      `https://www.lundin.se/dc/MED00000000000000000${n}.jpg?${query}`;
    const thumb = 'mode=max&w=640&h=480&scale=down';
    const expected = {
      photo: { url: dc(11, thumb), attribution: 'Lundin' },
      morePhotos: [12, 13, 14].map((n) => ({ url: dc(n, thumb) })),
      floorPlan: { url: dc(21, 'mode=max&w=1200&h=1200&scale=down') },
    };
    const memory = emptyMemory();
    const first = fakeFetch(site([numbered(1), numbered(2)]));
    const read = await run(goteborg, deps(first.impl), (all) => all, memory);
    expect(first.calls.map((call) => call.url)).toEqual([
      'https://www.lundin.se/robots.txt',
      LIST,
      'https://www.lundin.se/beskrivning/OBJ0000000000000000001/gata-1',
      'https://www.lundin.se/beskrivning/OBJ0000000000000000002/gata-2',
    ]);
    expect(read).toMatchObject({ detailRead: 2, stopped: null });
    expect(read.observations[0]).toMatchObject(expected);
    expect(read.observations[0].facts.lift).toBeNull();
    assertAdapterOutput(lundin().policy, read.observations[0]);

    // An hour later, by the next run's clock, the remembered pages are still fresh.
    for (const entry of Object.values(memory.details))
      entry.readAt = new Date(
        Date.parse(entry.readAt) - 3_600_000,
      ).toISOString();
    const again = fakeFetch(site([numbered(1), numbered(2)]));
    const cached = await run(goteborg, deps(again.impl), (all) => all, memory);
    expect(again.calls).toHaveLength(2);
    expect(cached).toMatchObject({ detailCached: 2, detailRead: 0 });
    expect(cached.observations[0]).toMatchObject(expected);
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

  it('accepts a list past the shared size cap and stops only past its own', async () => {
    const home = lundinList([numbered(1)]);
    const reply = (padding: number) => (url: string) =>
      url.endsWith('/robots.txt')
        ? robotsReply
        : { body: home + ' '.repeat(padding) };
    const grown = await run(goteborg, deps(fakeFetch(reply(4_950_000)).impl));
    expect(grown.stopped).toBeNull();
    expect(grown.partitions[0]).toMatchObject({
      status: 'read',
      observations: 1,
    });
    const events: LiveEvent[] = [];
    const runaway = await run(
      goteborg,
      deps(fakeFetch(reply(LUNDIN_MAX_CHARS)).impl, events),
    );
    expect(runaway.stopped).toBe('oversize');
    expect(
      events.find((event) => event.event === 'request-stopped')?.bodyChars,
    ).toBeGreaterThan(LUNDIN_MAX_CHARS);
    // Every other source keeps the shared cap.
    expect(boneoAdapter.maxBodyChars).toBeUndefined();
    expect(MAX_BODY_CHARS).toBe(3_000_000);
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
});
