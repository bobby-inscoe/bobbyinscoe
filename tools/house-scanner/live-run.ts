import { randomUUID } from 'node:crypto';
import { MAX_BATCH_OBSERVATIONS } from '@house-scanner-tools/collector';
import {
  type GeocodeCache,
  geocodeMissing,
} from '@house-scanner-tools/geocoder';
import { type LiveDeps, runCollection } from '@house-scanner-tools/live-reader';
import { prefilterObservations } from '@house-scanner-tools/prefilter';
import {
  planQueries,
  type queryPlanInputSchema,
} from '@house-scanner-tools/query-plan';
import type { LoadedMemory } from '@house-scanner-tools/run-memory';
import { adapterFor } from '@house-scanner-tools/source-adapters';
import type { SourceCapability } from '@house-scanner-tools/source-registry';
import type { z } from 'zod';
import {
  CONTRACT_VERSION,
  ingestRequestSchema,
  type Observation,
  observationSchema,
} from '@/features/house-scanner/types/contracts';

export interface LiveRunOptions {
  runId?: string;
  batchId?: string;
  capability: SourceCapability;
  planning: Omit<z.input<typeof queryPlanInputSchema>, 'capability'>;
  // Updated in place with the listing pages this run reads.
  memory?: LoadedMemory;
  // Estimated positions for kept homes the source gave none for; updated in place.
  geocodeCache?: GeocodeCache;
}

/**
 * Narrower than assertObservationAllowed: it skips the approval status, which
 * is the operator's database step, and checks what this reader controls.
 */
export function assertAdapterOutput(
  policy: SourceCapability['policy'],
  observation: Observation,
): void {
  observationSchema.parse(observation);
  const photoAllowed =
    observation.photo === null ||
    (policy.imageDisplay &&
      policy.imageHotlink &&
      policy.imageOrigins.includes(new URL(observation.photo.url).origin));
  if (
    !photoAllowed ||
    (observation.viewings?.length && policy.viewings !== true) ||
    observation.evidence.length > 0 ||
    !policy.listingOrigins.includes(new URL(observation.sourceUrl).origin)
  )
    throw new Error('Adapter output is outside the source policy.');
  for (const [key, value] of Object.entries(observation.facts)) {
    if (
      value !== null &&
      value !== 'unknown' &&
      !policy.allowedFactFields.some((field) => field === key)
    )
      throw new Error('Adapter output includes an unapproved fact field.');
  }
}

export async function prepareLiveRun(options: LiveRunOptions, deps: LiveDeps) {
  const adapter = adapterFor(options.capability);
  const queryPlan = planQueries({
    ...options.planning,
    capability: options.capability,
  });
  const prefilter = (observations: Observation[]) =>
    prefilterObservations(
      observations,
      options.planning.profiles
        .filter((profile) => profile.enabled)
        .map((profile) => profile.criteria),
    );
  const result = await runCollection(
    adapter,
    queryPlan.partitions.map(({ id, municipality, propertyTypes }) => ({
      id,
      municipality,
      propertyTypes,
    })),
    deps,
    (all) => prefilter(all).kept,
    options.memory?.memory ?? null,
  );
  for (const observation of result.observations)
    assertAdapterOutput(options.capability.policy, observation);
  // ponytail: the run ceiling counts collected observations, so a run that hits
  // it can lose matching listings to non-matching ones. Move this filter into
  // the page loop if runs ever approach the ceiling.
  const { kept, dropped } = prefilter(result.observations);
  const geocoded = options.geocodeCache
    ? await geocodeMissing(kept, options.geocodeCache, deps)
    : null;
  const droppedCount = Object.values(dropped).reduce((a, b) => a + b, 0);

  const pages = result.partitions.reduce((sum, p) => sum + p.pages, 0);
  const runId = options.runId ?? randomUUID();
  const common = { contractVersion: CONTRACT_VERSION, runId };
  const failed = result.stopped !== null && result.observations.length === 0;
  // Never "success": upcoming and unknown-price views are not queried and
  // pagination is unproven.
  // Plain sentences for people. The database prefixes the source and status and appends the
  // policy's gap list, which the app strips when it shows this.
  const coverageNote = [
    `Read ${result.observations.length} homes across ${pages} pages; kept ${kept.length} that fit your profile and dropped ${droppedCount}.`,
    `${adapter.detailLabel}: ${result.detailRead} read, ${result.detailCached} reused, ${result.detailFailed} failed, ${result.detailSkipped} skipped.`,
    geocoded
      ? `Positions estimated from addresses: ${geocoded.found} found (${geocoded.cached} reused).`
      : '',
    options.memory?.reset ? 'Run memory was unreadable and was reset.' : '',
    result.stopped ? `Stopped early: ${result.stopped}.` : '',
    adapter.notCovered,
  ]
    .filter(Boolean)
    .join(' ');
  const stages = [];
  for (let at = 0; at < kept.length; at += MAX_BATCH_OBSERVATIONS)
    stages.push(
      ingestRequestSchema.parse({
        ...common,
        action: 'stage',
        batchId: (at === 0 && options.batchId) || randomUUID(),
        sourceId: adapter.sourceId,
        observations: kept.slice(at, at + MAX_BATCH_OBSERVATIONS),
      }),
    );
  const requests = [
    ingestRequestSchema.parse({
      ...common,
      action: 'begin',
      profileVersions: queryPlan.profileVersions,
      sourceIds: [adapter.sourceId],
    }),
    ...stages,
    ingestRequestSchema.parse({
      ...common,
      action: 'publish',
      results: [
        {
          sourceId: adapter.sourceId,
          status: failed ? 'failed' : 'partial',
          cursor: null,
          coverageNote,
        },
      ],
    }),
  ];
  return {
    mode: 'live-read' as const,
    requests,
    queryPlan,
    result,
    prefilter: { kept: kept.length, dropped },
    publishStatus: failed ? ('failed' as const) : ('partial' as const),
    cacheReset: options.memory?.reset ?? false,
  };
}
