import {
  planQueries,
  queryPlanInputSchema,
} from '@house-scanner-tools/query-plan';
import {
  assertDemoExecution,
  capabilitySchema,
  DEMO_SOURCE_ID,
} from '@house-scanner-tools/source-registry';
import { z } from 'zod';
import {
  CONTRACT_VERSION,
  factsSchema,
  ingestRequestSchema,
  type Observation,
  observationSchema,
} from '@/features/house-scanner/types/contracts';
import { assertObservationAllowed } from '@/features/house-scanner/utils/source-policy';

// The server allows 100 observations per stage request and 100 requests per run.
export const MAX_RUN_OBSERVATIONS = 1000;
export const MAX_BATCH_OBSERVATIONS = 100;
export const MAX_REQUEST_BYTES = 256 * 1024;
const runOptionsSchema = z.strictObject({
  runId: z.uuid(),
  batchId: z.uuid(),
  at: z.iso.datetime({ offset: true }),
  capability: capabilitySchema,
  planning: queryPlanInputSchema.omit({ capability: true }),
});

export function sourceIdentity(
  sourceId: string,
  observation: Observation,
): string {
  return JSON.stringify([
    sourceId,
    observation.sourceListingId,
    observation.episodeId,
  ]);
}

export function compareAskingPrices(sourceId: string, input: Observation[]) {
  const observations = z
    .array(observationSchema)
    .max(MAX_RUN_OBSERVATIONS)
    .parse(input);
  const histories = new Map<string, Observation[]>();
  for (const observation of observations) {
    const identity = sourceIdentity(sourceId, observation);
    const history = histories.get(identity) ?? [];
    history.push(observation);
    histories.set(identity, history);
  }
  return [...histories.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([identity, history]) => {
      const ordered = history.toSorted(
        (left, right) =>
          Date.parse(left.observedAt) - Date.parse(right.observedAt),
      );
      let comparable: number | null = null;
      let previousAskingPriceSek: number | null = null;
      let changeObservedAt: string | null = null;
      let state: 'known' | 'unknown' | 'conflict' = 'unknown';
      // Equal-time contradictions have no ordering authority. Unknowns break comparability.
      for (let index = 0; index < ordered.length; ) {
        const observation = ordered[index];
        const sameTime: Observation[] = [];
        while (
          index < ordered.length &&
          Date.parse(ordered[index].observedAt) ===
            Date.parse(observation.observedAt)
        ) {
          sameTime.push(ordered[index]);
          index += 1;
        }
        const prices = new Set(
          sameTime.map((item) => item.facts.askingPriceSek),
        );
        if (
          prices.size > 1 ||
          sameTime.some((item) => item.conflicts.includes('askingPriceSek'))
        ) {
          comparable = null;
          previousAskingPriceSek = null;
          changeObservedAt = null;
          state = 'conflict';
          continue;
        }
        const price = observation.facts.askingPriceSek;
        if (price === null) {
          comparable = null;
          previousAskingPriceSek = null;
          changeObservedAt = null;
          state = 'unknown';
          continue;
        }
        if (comparable !== null && comparable !== price) {
          previousAskingPriceSek = comparable;
          changeObservedAt = observation.observedAt;
        }
        comparable = price;
        state = 'known';
      }
      return {
        identity,
        state,
        askingPriceSek: comparable,
        previousAskingPriceSek,
        changeObservedAt,
        historyStartsAt: ordered[0].observedAt,
        observedAt: ordered[ordered.length - 1].observedAt,
      };
    });
}

function fixtureObservations(at: string): Observation[] {
  const base = factsSchema.parse({
    propertyType: 'apartment',
    tenure: 'cooperative',
    purchase: true,
    livingAreaM2: 88,
    secondaryAreaM2: null,
    rooms: 3,
    askingPriceSek: 2_900_000,
    groundFloor: null,
    lift: null,
    liftServesHome: null,
    stepFree: null,
    outdoor: 'balcony',
    glazed: null,
    largePrivateTerrace: null,
    municipality: 'Example municipality',
    baseFeeSek: null,
    mandatoryMonthlySek: null,
    status: 'available',
  });
  const earlier = new Date(Date.parse(at) - 86_400_000).toISOString();
  const observation = (
    sourceListingId: string,
    observedAt: string,
    askingPriceSek: number | null,
    status: 'available' | 'upcoming',
  ) =>
    observationSchema.parse({
      sourceListingId,
      episodeId: 'demo-episode-1',
      sourceUrl: `https://example.invalid/listings/${sourceListingId}`,
      title: 'Fictional demo home',
      observedAt,
      publishedAt: null,
      facts: { ...base, askingPriceSek, status },
      conflicts: [],
      coordinates: null,
      evidence: [],
      photo: null,
    });
  return [
    observation('demo-home-1', earlier, 2_900_000, 'available'),
    observation('demo-home-1', at, 2_800_000, 'available'),
    observation('demo-home-2', at, null, 'upcoming'),
  ];
}

export function prepareFixtureRun(input: z.input<typeof runOptionsSchema>) {
  const options = runOptionsSchema.parse(input);
  const at = new Date(options.at);
  // Policy validation precedes even the local fixture executor.
  assertDemoExecution(options.capability, at);
  const queryPlan = planQueries({
    ...options.planning,
    capability: options.capability,
  });
  const observations = fixtureObservations(options.at);
  for (const observation of observations)
    assertObservationAllowed(options.capability.policy, observation, at);
  const common = { contractVersion: CONTRACT_VERSION, runId: options.runId };
  const requests = [
    ingestRequestSchema.parse({
      ...common,
      action: 'begin',
      profileVersions: queryPlan.profileVersions,
      sourceIds: [DEMO_SOURCE_ID],
    }),
    ingestRequestSchema.parse({
      ...common,
      action: 'stage',
      batchId: options.batchId,
      sourceId: DEMO_SOURCE_ID,
      observations,
    }),
    ingestRequestSchema.parse({
      ...common,
      action: 'publish',
      results: [
        {
          sourceId: DEMO_SOURCE_ID,
          status: 'success',
          cursor: null,
          coverageNote:
            'Synthetic fixture execution only. No live coverage or refresh.',
        },
      ],
    }),
  ];
  for (const request of requests) {
    if (Buffer.byteLength(JSON.stringify(request), 'utf8') > MAX_REQUEST_BYTES)
      throw new Error('Prepared request exceeds the collector byte ceiling.');
  }
  return {
    mode: 'fixture-dry' as const,
    liveCoverage: false as const,
    queryPlan,
    requests,
    priceComparisons: compareAskingPrices(DEMO_SOURCE_ID, observations),
  };
}
