import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  type LiveEvent,
  runCollection,
  USER_AGENT,
} from '@house-scanner-tools/live-reader';
import {
  assertAdapterOutput,
  prepareLiveRun,
} from '@house-scanner-tools/live-run';
import {
  deps,
  fakeFetch,
  type Reply,
} from '@house-scanner-tools/live-test-helpers';
import { parseRobots, robotsAllows } from '@house-scanner-tools/robots';
import {
  emptyMemory,
  type RunMemory,
  saveMemory,
} from '@house-scanner-tools/run-memory';
import {
  adapterFor,
  bjurforsAdapter,
  boneoAdapter,
} from '@house-scanner-tools/source-adapters';
import {
  approvedPolicy,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import { assertSourceAllowed } from '@/features/house-scanner/utils/source-policy';

const fixture = (name: string) =>
  readFileSync(resolve('tools/house-scanner/fixtures/bjurfors', name), 'utf8');
const ROBOTS = fixture('robots.txt');
const BASE = '/sv/tillsalu/vastra-gotaland/goteborg';
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
) => runCollection(bjurforsAdapter, ...args);

const isSearch = (url: string) => new URL(url).pathname === BASE;
const isDetail = (url: string) =>
  url.includes(`${BASE}/`) && !isSearch(url) && !url.endsWith('robots.txt');
const detailCalls = (calls: { url: string }[]) =>
  calls.filter((call) => isDetail(call.url));

const robotsOr =
  (page: (url: string, n: number) => Reply) =>
  (url: string, n: number): Reply =>
    url.endsWith('/robots.txt')
      ? { body: ROBOTS, type: 'text/plain' }
      : page(url, n);

// The real fixtures: page 1 holds 8 usable cards of 12, page 2 ends the list.
const fixtureSite = (detail: string = fixture('detail-full.html')) =>
  robotsOr((url) => {
    if (isDetail(url)) return { body: detail };
    return {
      body: fixture(
        new URL(url).searchParams.get('page') === '2'
          ? 'search-page-more.html'
          : 'search-page.html',
      ),
    };
  });

// Small generated pages for the cap tests: `per` cards a page from id 1.
function card(id: number) {
  return `<li><div class="c-object-card o-intrinsic"><a class="c-object-card__link" href="${BASE}/omrade/gata-${id}/"><span class="c-object-card__city-area">Område, Göteborg</span><span class="c-object-card__address">Gata ${id}</span></a><ul><li class="c-object-card__meta">60 kvm</li><li class="c-object-card__meta">2 rum</li></ul></div></li>`;
}
function generated(ids: number[], total: number) {
  return `<h2 class="c-search-result__heading"><strong>${total}</strong> bostäder till salu</h2><ul class="c-search-result__list o-grid-list">${ids.map(card).join('')}</ul>`;
}
const generatedSite =
  (total: number, per: number, detail: (id: number) => Reply) =>
  (url: string): Reply => {
    if (isDetail(url))
      return detail(Number(url.split('-').at(-1)?.slice(0, -1)));
    const page = Number(new URL(url).searchParams.get('page') ?? '1');
    const first = (page - 1) * per + 1;
    const last = Math.min(total, page * per);
    return {
      body: generated(
        Array.from(
          { length: Math.max(0, last - first + 1) },
          (_v, i) => first + i,
        ),
        total,
      ),
    };
  };
const FULL = fixture('detail-full.html');
const keepAll = <T>(all: T[]) => all;

describe('Bjurfors guarded run', () => {
  it('sends the ordinary Accept headers and the honest user agent on every request', async () => {
    const { impl, calls } = fakeFetch(fixtureSite());
    await run(goteborg, deps(impl), keepAll);
    expect(calls.length).toBeGreaterThan(4);
    for (const { init } of calls) {
      expect(init.headers).toEqual({
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'sv-SE,sv;q=0.9,en;q=0.8',
      });
      expect(init.credentials).toBe('omit');
      expect(init.redirect).toBe('manual');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('reads the real answer only when the headers are sent, as the site answers empty otherwise', async () => {
    const { impl: inner } = fakeFetch(fixtureSite());
    const gated = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      return headers.accept?.includes('xhtml') && headers['accept-language']
        ? inner(input, init)
        : Promise.resolve(new Response('', { status: 200 }));
    }) as typeof fetch;
    const result = await run(goteborg, deps(gated));
    expect(result.stopped).toBeNull();
    expect(result.observations).toHaveLength(9);
  });

  it('treats an empty 200 body as failed coverage, not an empty result', async () => {
    const { impl } = fakeFetch(robotsOr(() => ({ body: '' })));
    const result = await run(goteborg, deps(impl));
    expect(result.stopped).toBe('no-results-list');
    expect(result.observations).toEqual([]);
    expect(result.partitions[0]).toMatchObject({
      status: 'failed',
      reason: 'no-results-list',
      observations: 0,
    });
  });

  it('treats a tiny 200 body and a page without the list as failed coverage', async () => {
    for (const body of ['<html></html>', fixture('blocked-page.html')]) {
      const { impl } = fakeFetch(robotsOr(() => ({ body })));
      const result = await run(goteborg, deps(impl));
      expect(result.partitions[0]).toMatchObject({
        status: 'failed',
        reason: 'no-results-list',
      });
    }
    const wrong = fakeFetch(
      robotsOr(() => ({ body: fixture('search-page-wrong-shape.html') })),
    );
    expect((await run(goteborg, deps(wrong.impl))).stopped).toBe(
      'unexpected-shape',
    );
  });

  it('follows the pages until the total is reached and drops repeats', async () => {
    const { impl, calls } = fakeFetch(fixtureSite());
    const result = await run(goteborg, deps(impl));
    expect(calls.map((call) => call.url)).toEqual([
      'https://www.bjurfors.se/robots.txt',
      `https://www.bjurfors.se${BASE}`,
      `https://www.bjurfors.se${BASE}?page=2`,
    ]);
    expect(result.partitions[0]).toMatchObject({
      status: 'read',
      pages: 2,
      total: 12,
      observations: 9,
      skipped: 3,
    });
    expect(result.observations.map((o) => o.title)).toContain(
      'Exempelgatan 11',
    );
    expect(
      result.observations.filter((o) => o.title === 'Exempelgatan 1'),
    ).toHaveLength(1);
  });

  it('stops and reports truncation on an empty page before the total', async () => {
    const { impl, calls } = fakeFetch(
      robotsOr((url) => ({
        body: fixture(
          new URL(url).searchParams.get('page') === '2'
            ? 'search-page-empty.html'
            : 'search-page.html',
        ),
      })),
    );
    const result = await run(goteborg, deps(impl));
    expect(calls).toHaveLength(3);
    expect(result.partitions[0]).toMatchObject({
      status: 'truncated',
      reason: 'empty-page-before-total',
    });
  });

  it('supports only the municipality it knows and any property type', async () => {
    const { impl, calls } = fakeFetch(robotsOr(() => ({ body: '' })));
    const result = await run(
      [{ id: 'm', municipality: 'Malmö', propertyTypes: ['apartment'] }],
      deps(impl),
    );
    expect(result.partitions[0]).toMatchObject({
      status: 'unsupported',
      reason: 'municipality-path-unproven',
    });
    expect(calls).toHaveLength(1);
    const houses = fakeFetch(fixtureSite());
    await run(
      [{ id: 'h', municipality: 'Göteborg', propertyTypes: ['house'] }],
      deps(houses.impl),
    );
    expect(houses.calls.some((c) => isSearch(c.url))).toBe(true);
  });

  it('checks robots.txt for the exact search path before each page', async () => {
    const refusePageTwo = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? {
            body: `User-agent: *\nDisallow: ${BASE}?page=2\nAllow: /\n`,
            type: 'text/plain',
          }
        : fixtureSite()(url, 0),
    );
    const result = await run(goteborg, deps(refusePageTwo.impl));
    expect(result.stopped).toBe('robots-disallow');
    expect(result.observations).toHaveLength(8);
    expect(result.partitions[0]).toMatchObject({
      status: 'failed',
      reason: 'robots-disallow',
    });
    const refuseAll = fakeFetch((url) =>
      url.endsWith('/robots.txt')
        ? {
            body: 'User-agent: *\nDisallow: /sv/tillsalu/\n',
            type: 'text/plain',
          }
        : fixtureSite()(url, 0),
    );
    const refused = await run(goteborg, deps(refuseAll.impl));
    expect(refused.stopped).toBe('robots-disallow');
    expect(refuseAll.calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/robots.txt',
    ]);
  });

  it('allows the search and listing paths under the real rule shapes and refuses the disallowed ones', () => {
    const rules = parseRobots(ROBOTS);
    expect(robotsAllows(rules, BASE)).toBe(true);
    expect(robotsAllows(rules, `${BASE}?page=38`)).toBe(true);
    expect(robotsAllows(rules, `${BASE}/omrade/gata-1/`)).toBe(true);
    expect(robotsAllows(rules, '/globalassets/fixture-privat/x.jpg')).toBe(
      false,
    );
    expect(robotsAllows(rules, '/contentassets/abc/plan.pdf')).toBe(false);
    expect(robotsAllows(rules, '/contentassets/abc/photo.jpg')).toBe(true);
  });

  it.each([
    [403, 'http-403'],
    [429, 'http-429'],
    [500, 'http-non-200'],
    [302, 'http-non-200'],
  ])(
    'stops the run on search page status %i without retrying',
    async (status, reason) => {
      const { impl, calls } = fakeFetch(robotsOr(() => ({ status })));
      const result = await run(goteborg, deps(impl));
      expect(result.stopped).toBe(reason);
      expect(calls).toHaveLength(2);
    },
  );

  it.each([
    [new TypeError('socket'), 'network-error'],
    [new DOMException('late', 'TimeoutError'), 'timeout'],
  ])(
    'stops the run on a search page network failure %#',
    async (error, reason) => {
      const { impl } = fakeFetch(robotsOr(() => error));
      expect((await run(goteborg, deps(impl))).stopped).toBe(reason);
    },
  );
});

describe('Bjurfors listing pages', () => {
  it('reads each kept listing page once and merges its facts and coordinates', async () => {
    const { impl, calls } = fakeFetch(fixtureSite());
    const result = await run(goteborg, deps(impl), (all) =>
      all.filter((o) => ['Exempelgatan 1', 'Exempelplatsen'].includes(o.title)),
    );
    expect(detailCalls(calls).map((c) => new URL(c.url).pathname)).toEqual([
      `${BASE}/exempelomrade/exempelgatan-1/`,
      `${BASE}/exempelomrade/exempelplatsen/`,
    ]);
    expect(result).toMatchObject({ detailRead: 2, detailFailed: 0 });
    const read = result.observations.find((o) => o.title === 'Exempelgatan 1');
    expect(read).toMatchObject({
      facts: {
        outdoor: 'balcony',
        groundFloor: false,
        lift: true,
        propertyType: 'apartment',
        tenure: 'cooperative',
        status: 'available',
        baseFeeSek: 3997,
        askingPriceSek: 3_250_000,
      },
      coordinates: {
        latitude: 57.7,
        longitude: 11.9,
        precision: 'address',
        source: 'bjurfors-listing-page',
        observedAt: read?.observedAt,
      },
    });
    // A title with no house number is not an address point.
    expect(
      result.observations.find((o) => o.title === 'Exempelplatsen')
        ?.coordinates,
    ).toMatchObject({ precision: 'approximate_area' });
    const untouched = result.observations.find(
      (o) => o.title === 'Exempelgatan 2',
    );
    expect(untouched?.coordinates).toBeNull();
    expect(untouched?.facts).toMatchObject({
      outdoor: null,
      groundFloor: null,
      tenure: 'unknown',
    });
  });

  it('keeps unknown values from the page from overwriting what the card said', async () => {
    const { impl } = fakeFetch(fixtureSite(fixture('detail-missing.html')));
    const result = await run(goteborg, deps(impl), keepAll);
    const first = result.observations.find((o) => o.title === 'Exempelgatan 1');
    expect(first?.facts).toMatchObject({
      livingAreaM2: 62,
      rooms: 2,
      askingPriceSek: 3_250_000,
      purchase: true,
      outdoor: null,
      lift: null,
      groundFloor: null,
    });
    expect(first?.coordinates).toBeNull();
  });

  it('fetches details only for the listings the profile keeps, judged from the cards', async () => {
    const planning = profilePlanning({
      minAreaM2: 60,
      stretchPriceSek: 10_000_000,
    });
    const { impl, calls } = fakeFetch(fixtureSite());
    const prepared = await prepareLiveRun(
      { capability: bjurfors(), planning },
      deps(impl),
    );
    // Dropped from the cards alone: 35.5 and 58 m2, and the 11.9 million house.
    expect(prepared.prefilter.dropped).toMatchObject({
      'living-area': 2,
      'asking-price': 1,
    });
    const paths = detailCalls(calls).map((c) =>
      new URL(c.url).pathname.split('/').at(-2),
    );
    expect(paths.toSorted()).toEqual(
      [
        'exempelgatan-1',
        'exempelgatan-11',
        'exempelgatan-2',
        'exempelgatan-6',
        'exempelgatan-7',
        'exempelplatsen',
      ].toSorted(),
    );
    expect(prepared.result.detailRead).toBe(6);
  });

  it('reads no listing page unless the caller keeps the observation', async () => {
    const { impl, calls } = fakeFetch(fixtureSite());
    await run(goteborg, deps(impl));
    expect(detailCalls(calls)).toHaveLength(0);
  });

  it('counts a failed listing page, including an empty one, and carries on', async () => {
    const replies: Reply[] = [
      { status: 500 },
      { status: 404 },
      { body: '' },
      { body: fixture('detail-wrong-shape.html') },
      { body: FULL },
    ];
    const events: LiveEvent[] = [];
    const { impl } = fakeFetch(
      robotsOr(generatedSite(5, 25, (id) => replies[id - 1])),
    );
    const result = await run(goteborg, deps(impl, events), keepAll);
    expect(result).toMatchObject({
      detailRead: 1,
      detailFailed: 4,
      stopped: null,
    });
    expect(
      events.filter((e) => e.event === 'detail-failed').map((e) => e.reason),
    ).toEqual([
      'http-non-200',
      'http-non-200',
      'no-embedded-data',
      'unexpected-shape',
    ]);
    expect(JSON.stringify(events)).not.toMatch(/https:|bjurfors|gata/i);
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
        robotsOr(
          generatedSite(4, 25, (id) => (id === 2 ? stop : { body: FULL })),
        ),
      );
      const result = await run(goteborg, deps(impl), keepAll);
      expect(result.stopped).toBe(reason);
      expect(detailCalls(calls)).toHaveLength(2);
    },
  );
});

describe('Bjurfors run memory', () => {
  const NOW = 1_760_000_000_000;
  const DAY = 86_400_000;
  const memoryOf = (details: RunMemory['details'] = {}): RunMemory => ({
    ...emptyMemory(),
    details,
  });

  it('stores what the listing page supplied and reuses it for a week', async () => {
    const memory = memoryOf();
    const first = fakeFetch(fixtureSite());
    const one = await run(goteborg, deps(first.impl), keepAll, memory);
    expect(Object.keys(memory.details)).toHaveLength(9);
    const id = `vastra-gotaland/goteborg/exempelomrade/exempelgatan-1`;
    expect(memory.details[id]).toMatchObject({
      outdoor: 'balcony',
      glazed: null,
      groundFloor: false,
      lift: true,
      propertyType: 'apartment',
      tenure: 'cooperative',
      status: 'available',
      baseFeeSek: 3997,
      latitude: 57.7,
      longitude: 11.9,
    });
    for (const entry of Object.values(memory.details))
      entry.readAt = new Date(Date.parse(entry.readAt) - DAY).toISOString();
    const second = fakeFetch(fixtureSite());
    const two = await run(goteborg, deps(second.impl), keepAll, memory);
    expect(detailCalls(second.calls)).toHaveLength(0);
    expect(two).toMatchObject({
      detailRead: 0,
      detailCached: 9,
      detailFailed: 0,
    });
    expect(two.observations).toEqual(one.observations);
  });

  it('writes ids, small enums and numbers only', async () => {
    const memory = memoryOf();
    const { impl } = fakeFetch(fixtureSite());
    await run(goteborg, deps(impl), keepAll, memory);
    const path = join(mkdtempSync(join(tmpdir(), 'hs-bjurfors-')), 'c.json');
    saveMemory(path, memory, NOW);
    const text = readFileSync(path, 'utf8');
    for (const value of [
      'https',
      'bjurfors.se',
      'Exempel',
      'beskrivning',
      'Syntetisk',
    ])
      expect(text).not.toContain(value);
    const saved = JSON.parse(text);
    for (const entry of Object.values<object>(saved.details))
      expect(Object.keys(entry).toSorted()).toEqual(
        [
          'askingPriceSek',
          'baseFeeSek',
          'glazed',
          'groundFloor',
          'latitude',
          'lift',
          'livingAreaM2',
          'longitude',
          'outdoor',
          'propertyType',
          'readAt',
          'rooms',
          'status',
          'tenure',
        ].toSorted(),
      );
  });
});

function bjurfors() {
  const found = sourceRegistry().find((e) => e.policy.sourceId === 'bjurfors');
  if (!found) throw new Error('bjurfors missing');
  return found;
}
function profilePlanning(overrides: {
  minAreaM2: number;
  stretchPriceSek: number;
}) {
  const profile = SYNTHETIC_SNAPSHOT.profiles[0];
  return {
    profiles: [
      {
        id: profile.id,
        revision: profile.revision,
        enabled: true,
        criteria: {
          ...profile.criteria,
          ...overrides,
          minRooms: 1,
          geography: {
            ...profile.criteria.geography,
            municipalities: ['Göteborg'],
          },
        },
      },
    ],
    collectionPriceCapSek: null,
    maxPartitions: 5,
  };
}

describe('Bjurfors registry entry and run', () => {
  it('registers bjurfors as a pending source with an honest policy', () => {
    const { policy, executor } = bjurfors();
    expect(executor).toBe('bjurfors-personal-read');
    expect(policy).toMatchObject({
      sourceId: 'bjurfors',
      status: 'pending',
      revision: 2,
      viewings: true,
      retentionDays: 14,
      automatedCollection: false,
      privateDisplay: false,
      listingOrigins: ['https://www.bjurfors.se'],
      imageOrigins: ['https://www.bjurfors.se'],
      imageDisplay: true,
      imageHotlink: true,
      capabilities: { upcoming: false, unknownPrice: false, pagination: false },
    });
    expect(policy.allowedFactFields).toEqual(
      expect.arrayContaining(['groundFloor', 'outdoor', 'lift']),
    );
    expect(policy.allowedFactFields).not.toContain('glazed');
    expect(policy.capabilities.coverageGaps.length).toBeGreaterThan(5);
    expect(() =>
      assertSourceAllowed(policy, new Date('2026-10-16T00:00:00Z')),
    ).toThrow();
  });

  it('builds an approved policy only for a registry source, leaving the rest unchanged', () => {
    const approved = approvedPolicy(
      'bjurfors',
      new Date('2026-10-16T12:00:00Z'),
    );
    expect(approved).toMatchObject({
      sourceId: 'bjurfors',
      status: 'approved',
      revision: 2,
      automatedCollection: true,
      privateDisplay: true,
      imageOrigins: ['https://www.bjurfors.se'],
    });
    expect(
      approved.capabilities.coverageGaps.some((gap) =>
        gap.includes('not approved'),
      ),
    ).toBe(false);
  });

  it('prepares valid requests for source bjurfors and never reports success', async () => {
    const { impl } = fakeFetch(fixtureSite());
    const prepared = await prepareLiveRun(
      {
        runId: '00000000-0000-4000-8000-000000000301',
        batchId: '00000000-0000-4000-8000-000000000302',
        capability: bjurfors(),
        planning: profilePlanning({
          minAreaM2: 20,
          stretchPriceSek: 20_000_000,
        }),
      },
      deps(impl),
    );
    expect(prepared.requests.map((r) => r.action)).toEqual([
      'begin',
      'stage',
      'publish',
    ]);
    const [begin, stage, publish] = prepared.requests;
    expect(begin.action === 'begin' && begin.sourceIds).toEqual(['bjurfors']);
    expect(stage.action === 'stage' && stage.sourceId).toBe('bjurfors');
    expect(publish.action === 'publish' && publish.results[0]).toMatchObject({
      sourceId: 'bjurfors',
      status: 'partial',
      cursor: null,
    });
    const note =
      publish.action === 'publish' ? publish.results[0].coverageNote : '';
    expect(note).toContain('Read 9 homes across 2 pages');
    expect(note).toContain(
      'Listing pages: 9 read, 0 reused, 0 failed, 0 skipped.',
    );
    expect(note).toContain('Not covered: other cities.');
    expect(note).not.toContain('Balcony and glazing');
  });

  it('publishes failed coverage and no stage when the first page is empty', async () => {
    const { impl } = fakeFetch(robotsOr(() => ({ body: '' })));
    const prepared = await prepareLiveRun(
      {
        capability: bjurfors(),
        planning: profilePlanning({
          minAreaM2: 20,
          stretchPriceSek: 20_000_000,
        }),
      },
      deps(impl),
    );
    expect(prepared.publishStatus).toBe('failed');
    expect(prepared.requests.map((r) => r.action)).toEqual([
      'begin',
      'publish',
    ]);
  });

  it('rejects a fact field the policy does not allow, and photos from other hosts', async () => {
    const { impl } = fakeFetch(fixtureSite());
    const result = await run(goteborg, deps(impl), keepAll);
    const observation = result.observations[0];
    const { policy } = bjurfors();
    expect(() => assertAdapterOutput(policy, observation)).not.toThrow();
    const narrowed = {
      ...policy,
      allowedFactFields: policy.allowedFactFields.filter(
        (f) => f !== 'groundFloor',
      ),
    };
    expect(() =>
      assertAdapterOutput(narrowed, {
        ...observation,
        facts: { ...observation.facts, groundFloor: false },
      }),
    ).toThrow('unapproved fact field');
    const photo = observation.photo;
    if (!photo) throw new Error('fixture photo missing');
    expect(() =>
      assertAdapterOutput(policy, {
        ...observation,
        photo: { ...photo, url: 'https://files.boneo.se/x.jpg' },
      }),
    ).toThrow('outside the source policy');
    expect(() =>
      assertAdapterOutput({ ...policy, imageHotlink: false }, observation),
    ).toThrow('outside the source policy');
  });
});

describe('executor guards', () => {
  const base = () => bjurfors();
  const refused = (change: (c: ReturnType<typeof base>) => unknown) => {
    const capability = structuredClone(base());
    return () => adapterFor(change(capability) as typeof capability);
  };

  it('accepts exactly the registry entries of the two sources', () => {
    expect(adapterFor(base())).toBe(bjurforsAdapter);
    const boneo = sourceRegistry().find((e) => e.policy.sourceId === 'boneo');
    if (!boneo) throw new Error('boneo missing');
    expect(adapterFor(boneo)).toBe(boneoAdapter);
  });

  it.each([
    [
      'the wrong source id',
      (c: ReturnType<typeof base>) => {
        c.policy.sourceId = 'boneo';
        return c;
      },
    ],
    [
      'a different listing origin',
      (c: ReturnType<typeof base>) => {
        c.policy.listingOrigins = ['https://www.bjurfors.se.example.invalid'];
        return c;
      },
    ],
    [
      'an extra listing origin',
      (c: ReturnType<typeof base>) => {
        c.policy.listingOrigins = [
          'https://www.bjurfors.se',
          'https://www.boneo.se',
        ];
        return c;
      },
    ],
    [
      'a plain http origin',
      (c: ReturnType<typeof base>) => {
        c.policy.listingOrigins = ['http://www.bjurfors.se'];
        return c;
      },
    ],
    [
      'no image origin',
      (c: ReturnType<typeof base>) => {
        c.policy.imageOrigins = [];
        return c;
      },
    ],
    [
      'the Boneo image origin',
      (c: ReturnType<typeof base>) => {
        c.policy.imageOrigins = ['https://files.boneo.se'];
        return c;
      },
    ],
    [
      'an extra image origin',
      (c: ReturnType<typeof base>) => {
        c.policy.imageOrigins = [
          'https://www.bjurfors.se',
          'https://cdn.example.invalid',
        ];
        return c;
      },
    ],
    [
      'the Boneo executor',
      (c: ReturnType<typeof base>) => {
        c.executor = 'boneo-personal-read';
        return c;
      },
    ],
    [
      'no executor',
      (c: ReturnType<typeof base>) => {
        c.executor = 'none';
        return c;
      },
    ],
  ])('refuses a bjurfors capability with %s', (_name, change) => {
    expect(refused(change)).toThrow('No permitted executor');
  });

  it('refuses a boneo capability pointed at the bjurfors hosts', () => {
    const boneo = structuredClone(
      sourceRegistry().find((e) => e.policy.sourceId === 'boneo'),
    );
    if (!boneo) throw new Error('boneo missing');
    boneo.policy.listingOrigins = ['https://www.bjurfors.se'];
    expect(() => adapterFor(boneo)).toThrow('No permitted executor');
  });

  it('makes no request when the capability is refused', async () => {
    const { impl, calls } = fakeFetch(fixtureSite());
    const capability = structuredClone(base());
    capability.policy.imageOrigins = [];
    await expect(
      prepareLiveRun(
        {
          capability,
          planning: profilePlanning({
            minAreaM2: 20,
            stretchPriceSek: 20_000_000,
          }),
        },
        deps(impl),
      ),
    ).rejects.toThrow('No permitted executor');
    expect(calls).toHaveLength(0);
  });
});

describe('floor rule through both readers', () => {
  const nextData = (floor: unknown) =>
    `<script id="__NEXT_DATA__">${JSON.stringify({
      props: {
        pageProps: {
          property_detail: { field_property_balcony: true, field_floor: floor },
        },
      },
    })}</script>`;
  const boneoSearch = `<script id="__NEXT_DATA__">${JSON.stringify({
    props: {
      pageProps: {
        listData: {
          count: 1,
          pData: [
            {
              property_id: 1,
              slug: 'https://www.boneo.se/bostad/fixture-1',
              title_field: 'Fixturegatan 1',
              created_date: '2026-09-30T08:00:00.000Z',
              field_status_id: 'Till salu',
              is_active: true,
            },
          ],
        },
      },
    },
  })}</script>`;
  const bjurforsDetail = (floor: string) => FULL.replace(/3 av 5/g, floor);
  const table: [string, boolean | null][] = [
    ['3', false],
    ['2', false],
    ['2 av 7', false],
    ['1', null],
    ['1 av 5', null],
    ['0', true],
    ['BV', true],
    ['bottenvåning', true],
    ['', null],
    ['vind', null],
  ];

  it.each(table)(
    'Bjurfors floor %j gives groundFloor %j',
    async (floor, expected) => {
      const { impl } = fakeFetch(fixtureSite(bjurforsDetail(floor)));
      const result = await run(goteborg, deps(impl), keepAll);
      expect(result.observations[0].facts.groundFloor).toBe(expected);
    },
  );

  it.each(table)(
    'Boneo field_floor %j gives groundFloor %j',
    async (floor, expected) => {
      const { impl } = fakeFetch(
        robotsOr((url) => ({
          body: url.includes('/bostad/') ? nextData(floor) : boneoSearch,
        })),
      );
      const result = await runCollection(
        boneoAdapter,
        goteborg,
        deps(impl),
        keepAll,
      );
      expect(result.observations[0].facts.groundFloor).toBe(expected);
    },
  );

  it('allows groundFloor in both source policies and revises Boneo to 5', () => {
    for (const id of ['boneo', 'bjurfors']) {
      const entry = sourceRegistry().find((e) => e.policy.sourceId === id);
      expect(entry?.policy.allowedFactFields).toContain('groundFloor');
    }
    expect(
      sourceRegistry().find((e) => e.policy.sourceId === 'boneo')?.policy
        .revision,
    ).toBe(5);
  });
});

describe('Bjurfors viewing times in a run', () => {
  // The fake clock is 9 October 2025, so the first time is ahead of it and the second is behind it.
  const block = `<div id="visning"><ol>${[
    '2025-10-11T10:00',
    '2025-10-01T10:00',
  ]
    .map(
      (start) =>
        `<li><time datetime="${start}">x</time><time datetime="PT1H">y</time></li>`,
    )
    .join('')}</ol></div>`;
  const page = fixture('detail-full.html').replace(
    '</body>',
    `${block}</body>`,
  );
  const coming = [
    {
      startsAt: '2025-10-11T08:00:00.000Z',
      endsAt: '2025-10-11T09:00:00.000Z',
    },
  ];

  it('puts the future viewings on the observation and keeps them in the run memory', async () => {
    const memory = { ...emptyMemory(), details: {} } as RunMemory;
    const { impl } = fakeFetch(fixtureSite(page));
    const result = await run(goteborg, deps(impl), keepAll, memory);
    expect(result.observations.every((o) => o.viewings?.length === 1)).toBe(
      true,
    );
    expect(result.observations[0].viewings).toEqual(coming);
    expect(Object.values(memory.details)[0].viewings).toEqual(coming);
  });

  it('applies remembered viewings without a request, and drops those that have passed', async () => {
    const memory = { ...emptyMemory(), details: {} } as RunMemory;
    await run(
      goteborg,
      deps(fakeFetch(fixtureSite(page)).impl),
      keepAll,
      memory,
    );
    const again = fakeFetch(fixtureSite(page));
    for (const entry of Object.values(memory.details))
      entry.readAt = new Date(
        Date.parse(entry.readAt) - 86_400_000,
      ).toISOString();
    const cached = await run(goteborg, deps(again.impl), keepAll, memory);
    expect(detailCalls(again.calls)).toHaveLength(0);
    expect(cached.observations[0].viewings).toEqual(coming);
    for (const entry of Object.values(memory.details))
      entry.viewings = [{ startsAt: '2025-10-01T08:00:00.000Z', endsAt: null }];
    const stale = await run(
      goteborg,
      deps(fakeFetch(fixtureSite(page)).impl),
      keepAll,
      memory,
    );
    expect(stale.observations[0]).not.toHaveProperty('viewings');
  });
});
