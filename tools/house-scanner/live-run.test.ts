import { readBoneoSearchPage } from '@house-scanner-tools/boneo-parser';
import {
  assertAdapterOutput,
  prepareLiveRun,
} from '@house-scanner-tools/live-run';
import {
  boneoFixture,
  boneoRobotsOr,
  deps,
  fakeFetch,
  nextPage,
} from '@house-scanner-tools/live-test-helpers';
import { planQueries } from '@house-scanner-tools/query-plan';
import { emptyMemory } from '@house-scanner-tools/run-memory';
import { sourceRegistry } from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import { assertSourceAllowed } from '@/features/house-scanner/utils/source-policy';

describe('prepared run', () => {
  const capability = sourceRegistry().find(
    (entry) => entry.policy.sourceId === 'boneo',
  );
  if (!capability) throw new Error('boneo missing');
  const profile = SYNTHETIC_SNAPSHOT.profiles[0];
  const planning = {
    profiles: [
      {
        id: profile.id,
        revision: profile.revision,
        enabled: true,
        criteria: {
          ...profile.criteria,
          minAreaM2: 20,
          minRooms: 1,
          stretchPriceSek: 10_000_000,
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

  it('registers boneo as pending with honest capabilities', () => {
    expect(capability.policy).toMatchObject({
      status: 'pending',
      automatedCollection: false,
      imageDisplay: true,
      imageHotlink: true,
      imageOrigins: ['https://files.boneo.se'],
      retentionDays: 14,
      revision: 5,
      capabilities: {
        upcoming: false,
        unknownPrice: false,
        pagination: false,
      },
    });
    expect(capability.policy.capabilities.coverageGaps.length).toBeGreaterThan(
      3,
    );
    expect(capability.policy.allowedFactFields).toEqual(
      expect.arrayContaining(['outdoor', 'glazed', 'groundFloor']),
    );
    const gaps = capability.policy.capabilities.coverageGaps.join(' ');
    expect(gaps).not.toContain('not structured fields');
    expect(gaps).toContain('Lift and build year are not collected');
    expect(() =>
      assertSourceAllowed(capability.policy, new Date('2026-10-13T00:00:00Z')),
    ).toThrow();
    const plan = planQueries({ ...planning, capability });
    expect(plan.permission).toBe('denied-no-permission');
    expect(plan.partitions.map((p) => p.municipality)).toEqual(['Göteborg']);
  });

  it('builds valid requests and never reports success', async () => {
    const { impl } = fakeFetch(
      boneoRobotsOr(() => ({ body: boneoFixture('search-page.html') })),
    );
    const prepared = await prepareLiveRun(
      {
        runId: '00000000-0000-4000-8000-000000000201',
        batchId: '00000000-0000-4000-8000-000000000202',
        capability,
        planning,
      },
      deps(impl),
    );
    expect(prepared.requests.map((r) => r.action)).toEqual([
      'begin',
      'stage',
      'publish',
    ]);
    const publish = prepared.requests[2];
    expect(publish.action === 'publish' && publish.results[0]).toMatchObject({
      sourceId: 'boneo',
      status: 'partial',
      cursor: null,
    });
    expect(prepared.result.observations).toHaveLength(8);
  });

  it('reads the page of each kept listing and stages outdoor and glazed', async () => {
    const { impl, calls } = fakeFetch(
      boneoRobotsOr((url) => ({
        body: url.includes('/bostad/')
          ? boneoFixture('detail-glazed.html')
          : boneoFixture('search-page.html'),
      })),
    );
    const prepared = await prepareLiveRun({ capability, planning }, deps(impl));
    const pages = calls.filter((call) => call.url.includes('/bostad/'));
    expect(pages.length).toBeGreaterThan(0);
    expect(prepared.result.detailRead).toBe(pages.length);
    expect(prepared.prefilter.kept).toBe(pages.length);
    const stage = prepared.requests[1];
    expect(
      stage.action === 'stage' && stage.observations[0].facts,
    ).toMatchObject({ outdoor: 'balcony', glazed: true });
    const publish = prepared.requests.at(-1);
    expect(
      publish?.action === 'publish' && publish.results[0].coverageNote,
    ).toContain(
      `Balcony and glazing: ${pages.length} read, 0 reused, 0 failed, 0 skipped.`,
    );
  });

  it('never reads the page of a listing the pre-filter drops', async () => {
    const { impl, calls } = fakeFetch(
      boneoRobotsOr((url) => ({
        body: url.includes('/bostad/')
          ? boneoFixture('detail-both.html')
          : boneoFixture('search-page.html'),
      })),
    );
    const strict = {
      ...planning,
      profiles: [
        {
          ...planning.profiles[0],
          criteria: {
            ...planning.profiles[0].criteria,
            minAreaM2: 5000,
            maxAreaM2: null,
          },
        },
      ],
    };
    const prepared = await prepareLiveRun(
      { capability, planning: strict },
      deps(impl),
    );
    expect(prepared.prefilter.kept).toBe(0);
    expect(calls.filter((call) => call.url.includes('/bostad/'))).toEqual([]);
    expect(prepared.result).toMatchObject({
      detailRead: 0,
      detailFailed: 0,
      detailSkipped: 0,
    });
  });

  it('reuses remembered listing pages on a second run and reports it', async () => {
    const serveAll = () =>
      fakeFetch(
        boneoRobotsOr((url) => ({
          body: url.includes('/bostad/')
            ? boneoFixture('detail-glazed.html')
            : boneoFixture('search-page.html'),
        })),
      );
    const memory = { memory: emptyMemory(), reset: true };
    const one = await prepareLiveRun(
      { capability, planning, memory },
      deps(serveAll().impl),
    );
    const kept = one.prefilter.kept;
    expect(one.cacheReset).toBe(true);
    expect(Object.keys(memory.memory.details)).toHaveLength(kept);
    // The fake clock restarts for each run, so age the entries by a day instead.
    for (const entry of Object.values(memory.memory.details))
      entry.readAt = new Date(
        Date.parse(entry.readAt) - 86_400_000,
      ).toISOString();
    const second = serveAll();
    const two = await prepareLiveRun(
      { capability, planning, memory: { ...memory, reset: false } },
      deps(second.impl),
    );
    expect(second.calls.filter((c) => c.url.includes('/bostad/'))).toEqual([]);
    expect(two.result).toMatchObject({ detailRead: 0, detailCached: kept });
    expect(two.cacheReset).toBe(false);
    const note = (run: typeof one) => {
      const publish = run.requests.at(-1);
      return publish?.action === 'publish'
        ? publish.results[0].coverageNote
        : '';
    };
    expect(note(one)).toContain('Run memory was unreadable and was reset.');
    expect(note(two)).toContain(`${kept} reused, 0 failed, 0 skipped`);
    expect(note(two)).not.toContain('reset');
    const stage = two.requests[1];
    expect(
      stage.action === 'stage' && stage.observations[0].facts,
    ).toMatchObject({ outdoor: 'balcony', glazed: true });
  });

  it('rejects outdoor and glazed unless the policy allows them', () => {
    const read = readBoneoSearchPage(boneoFixture('search-page.html'), {
      origin: 'https://www.boneo.se',
      observedAt: new Date('2026-10-13T09:00:00.000Z'),
      receivedBefore: 0,
    });
    if (read.kind !== 'page') throw new Error('fixture failed');
    const observation = read.observations[0];
    observation.facts.outdoor = 'balcony';
    expect(() =>
      assertAdapterOutput(capability.policy, observation),
    ).not.toThrow();
    const narrowed = {
      ...capability.policy,
      allowedFactFields: capability.policy.allowedFactFields.filter(
        (field) => field !== 'outdoor',
      ),
    };
    expect(() => assertAdapterOutput(narrowed, observation)).toThrow(
      'unapproved fact field',
    );
  });

  it('drops confirmed misfits, counts them by reason and still publishes partial', async () => {
    const { impl } = fakeFetch(
      boneoRobotsOr(() => ({ body: boneoFixture('search-page.html') })),
    );
    const strict = {
      ...planning,
      profiles: [
        {
          ...planning.profiles[0],
          criteria: {
            ...planning.profiles[0].criteria,
            minAreaM2: 5000,
            maxAreaM2: null,
          },
        },
      ],
    };
    const prepared = await prepareLiveRun(
      { capability, planning: strict },
      deps(impl),
    );
    expect(prepared.result.observations).toHaveLength(8);
    expect(prepared.prefilter.kept).toBe(0);
    expect(
      Object.values(prepared.prefilter.dropped).reduce((a, b) => a + b, 0),
    ).toBe(8);
    expect(prepared.requests.map((r) => r.action)).toEqual([
      'begin',
      'publish',
    ]);
    const publish = prepared.requests[1];
    expect(publish.action === 'publish' && publish.results[0]).toMatchObject({
      status: 'partial',
    });
    expect(
      publish.action === 'publish' && publish.results[0].coverageNote,
    ).toContain('kept 0 that fit your profile and dropped 8');
  });

  it('splits kept observations into stage requests of at most one hundred', async () => {
    const { impl } = fakeFetch(
      boneoRobotsOr((url) => {
        const page = Number(new URL(url).searchParams.get('page') ?? '1');
        return {
          body: nextPage(
            Array.from({ length: 25 }, (_v, i) => page * 100 + i),
            250,
          ),
        };
      }),
    );
    const prepared = await prepareLiveRun(
      {
        batchId: '00000000-0000-4000-8000-000000000202',
        capability,
        planning,
      },
      deps(impl),
    );
    expect(prepared.requests.map((r) => r.action)).toEqual([
      'begin',
      'stage',
      'stage',
      'stage',
      'publish',
    ]);
    const stages = prepared.requests.flatMap((r) =>
      r.action === 'stage' ? [r] : [],
    );
    expect(stages.map((s) => s.observations.length)).toEqual([100, 100, 50]);
    expect(stages[0].batchId).toBe('00000000-0000-4000-8000-000000000202');
    expect(new Set(stages.map((s) => s.batchId)).size).toBe(3);
    expect(
      new Set(
        stages.flatMap((s) => s.observations.map((o) => o.sourceListingId)),
      ).size,
    ).toBe(250);
  });

  it('publishes failed coverage and no stage when the first page lacks data', async () => {
    const { impl } = fakeFetch(
      boneoRobotsOr(() => ({ body: boneoFixture('blocked-page.html') })),
    );
    const prepared = await prepareLiveRun({ capability, planning }, deps(impl));
    expect(prepared.publishStatus).toBe('failed');
    expect(prepared.requests.map((r) => r.action)).toEqual([
      'begin',
      'publish',
    ]);
  });

  it('refuses a capability whose executor is not this adapter', async () => {
    const demo = sourceRegistry()[0];
    const { impl, calls } = fakeFetch(() => ({ body: '' }));
    await expect(
      prepareLiveRun({ capability: demo, planning }, deps(impl)),
    ).rejects.toThrow('No permitted executor');
    expect(calls).toHaveLength(0);
  });
});
