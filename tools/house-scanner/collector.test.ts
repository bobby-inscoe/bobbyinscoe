import {
  compareAskingPrices,
  prepareFixtureRun,
} from '@house-scanner-tools/collector';
import { planQueries } from '@house-scanner-tools/query-plan';
import { sourceRegistry } from '@house-scanner-tools/source-registry';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type { Observation } from '@/features/house-scanner/types/contracts';

const at = '2026-10-12T12:00:00Z';
const options = {
  at,
  runId: '00000000-0000-4000-8000-000000000101',
  batchId: '00000000-0000-4000-8000-000000000102',
  capability: sourceRegistry()[0],
  planning: {
    profiles: SYNTHETIC_SNAPSHOT.profiles.map(
      ({ id, revision, enabled, criteria }) => ({
        id,
        revision,
        enabled,
        criteria,
      }),
    ),
    collectionPriceCapSek: null,
    maxPartitions: 100,
  },
};
function observations() {
  const stage = prepareFixtureRun(options).requests.find(
    (request) => request.action === 'stage',
  );
  if (stage?.action !== 'stage') throw new Error('Fixture stage missing');
  return stage.observations;
}
function observation(
  price: number | null,
  hour: number,
  episodeId = 'episode-1',
): Observation {
  const base = observations()[0];
  return {
    ...base,
    episodeId,
    observedAt: `2026-10-12T${String(hour).padStart(2, '0')}:00:00Z`,
    facts: { ...base.facts, askingPriceSek: price },
  };
}

describe('local fixture collector', () => {
  it('prepares bounded synthetic requests without network access', () => {
    const run = prepareFixtureRun(options);
    expect(run.mode).toBe('fixture-dry');
    expect(run.liveCoverage).toBe(false);
    expect(run.requests.map((request) => request.action)).toEqual([
      'begin',
      'stage',
      'publish',
    ]);
    expect(observations()).toHaveLength(3);
    expect(
      run.priceComparisons.find((entry) => entry.askingPriceSek === 2800000)
        ?.previousAskingPriceSek,
    ).toBe(2900000);
    expect(run.queryPlan.gaps.join(' ')).toContain('no live discovery');
  });
  it('refuses every real-source executor and expired fixture policy', () => {
    for (const capability of sourceRegistry().slice(1))
      expect(() => prepareFixtureRun({ ...options, capability })).toThrow();
    expect(() =>
      prepareFixtureRun({ ...options, at: '2027-02-01T12:00:00Z' }),
    ).toThrow();
  });
  it('orders history and retains the last meaningful change across unchanged refreshes', () => {
    const [price] = compareAskingPrices('synthetic-demo', [
      observation(2800000, 12),
      observation(2900000, 10),
      observation(2800000, 11),
    ]);
    expect(price).toMatchObject({
      state: 'known',
      askingPriceSek: 2800000,
      previousAskingPriceSek: 2900000,
      changeObservedAt: '2026-10-12T11:00:00Z',
    });
  });
  it('breaks comparison across unknown observations and relisting episodes', () => {
    expect(
      compareAskingPrices('synthetic-demo', [
        observation(2900000, 10),
        observation(null, 11),
        observation(2800000, 12),
      ])[0].previousAskingPriceSek,
    ).toBeNull();
    expect(
      compareAskingPrices('synthetic-demo', [
        observation(2900000, 10),
        observation(2800000, 12, 'episode-2'),
      ]).every((price) => price.previousAskingPriceSek === null),
    ).toBe(true);
  });
  it('treats equal-time contradictions as unordered and clears comparison', () => {
    const history = [
      observation(2900000, 10),
      observation(2800000, 11),
      observation(2700000, 11),
    ];
    expect(compareAskingPrices('synthetic-demo', history)[0]).toMatchObject({
      state: 'conflict',
      askingPriceSek: null,
      previousAskingPriceSek: null,
    });
    expect(
      compareAskingPrices('synthetic-demo', [
        ...history,
        observation(2600000, 12),
      ])[0],
    ).toMatchObject({
      state: 'known',
      askingPriceSek: 2600000,
      previousAskingPriceSek: null,
    });
  });
  it('collects a broad enabled-profile union and discloses caps without applying unverified price filters', () => {
    const first = options.planning.profiles[0];
    const second = {
      ...first,
      id: '00000000-0000-4000-8000-000000000006',
      criteria: {
        ...first.criteria,
        minAreaM2: 40,
        maxAreaM2: null,
        stretchPriceSek: 9000000,
        geography: {
          ...first.criteria.geography,
          municipalities: ['Another municipality'],
        },
      },
    };
    const plan = planQueries({
      ...options.planning,
      capability: options.capability,
      profiles: [first, second],
      collectionPriceCapSek: 1000000,
      maxPartitions: 1,
    });
    expect(plan.envelope).toMatchObject({
      minAreaM2: 40,
      maxAreaM2: null,
      requiredPriceCapSek: 9000000,
      effectiveNativePriceCapSek: null,
    });
    expect(plan.nativeNumericFilters).toBeNull();
    expect(plan.partitions).toHaveLength(1);
    expect(plan.gaps.join(' ')).toContain('partition ceiling');
    expect(plan.gaps.join(' ')).toContain('not applied');
  });
});
