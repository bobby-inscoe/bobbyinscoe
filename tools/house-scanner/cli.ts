import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { prepareFixtureRun } from '@house-scanner-tools/collector';
import {
  GEOCODE_CACHE_PATH,
  loadGeocodeCache,
  saveGeocodeCache,
} from '@house-scanner-tools/geocoder';
import {
  defaultLiveDeps,
  type LiveEvent,
} from '@house-scanner-tools/live-reader';
import { prepareLiveRun } from '@house-scanner-tools/live-run';
import { COLLECTOR_MUNICIPALITY } from '@house-scanner-tools/prefilter';
import {
  DEFAULT_CACHE_PATH,
  RunTooSoonError,
  saveMemory,
  startLiveRun,
} from '@house-scanner-tools/run-memory';
import { senderConfig, sendRequests } from '@house-scanner-tools/sender';
import { collectSold } from '@house-scanner-tools/sold-collect';
import {
  loadNeighbourhoodShapes,
  loadSoldPool,
  NEIGHBOURHOODS_PATH,
  SOLD_POOL_PATH,
  saveSoldPool,
} from '@house-scanner-tools/sold-pool';
import { adapterFor } from '@house-scanner-tools/source-adapters';
import {
  BJURFORS_SOURCE_ID,
  BONEO_SOURCE_ID,
  DEMO_SOURCE_ID,
  ERIK_OLSSON_SOURCE_ID,
  HUSMAN_HAGBERG_SOURCE_ID,
  LUNDIN_SOURCE_ID,
  STADSHEM_SOURCE_ID,
  SVENSKFAST_SOURCE_ID,
  sourceRegistry,
} from '@house-scanner-tools/source-registry';
import { z } from 'zod';
import { criteriaSchema } from '@/features/house-scanner/types/contracts';

function fixtureCriteria(municipalities: string[]) {
  return criteriaSchema.parse({
    minAreaM2: 60,
    maxAreaM2: 120,
    minRooms: 2,
    preferredPriceSek: 4_000_000,
    stretchPriceSek: 5_000_000,
    propertyTypes: ['apartment', 'house'],
    excludeGroundFloor: false,
    requireLift: false,
    requireOutdoor: false,
    preferGlazing: false,
    feeReferenceSek: 5_000,
    geography: { municipalities, center: [0, 0], radiusKm: 10 },
    nature: { preferImmediateGreenery: false, preferredWalkMinutes: 10 },
    transit: {
      preferredWalkMinutes: 10,
      preferredJourneyMinutes: 30,
      tradeoffJourneyMinutes: 45,
    },
  });
}

type Values = {
  source?: string;
  at?: string;
  'confirm-personal-read': boolean;
  profiles?: string;
  send: boolean;
  'confirm-send': boolean;
  'run-id'?: string;
  'batch-id'?: string;
  cache?: string;
  force: boolean;
  live?: boolean;
};

const LIVE_SOURCES = [
  BONEO_SOURCE_ID,
  BJURFORS_SOURCE_ID,
  ERIK_OLSSON_SOURCE_ID,
  STADSHEM_SOURCE_ID,
  LUNDIN_SOURCE_ID,
  HUSMAN_HAGBERG_SOURCE_ID,
  SVENSKFAST_SOURCE_ID,
];

// Live reads need three explicit flags and cover Boneo, Bjurfors, Erik Olsson, Stadshem, Lundin, Husman Hagberg and Svensk Fastighetsförmedling only. Sending adds
// --send --confirm-send. Output is counts, statuses and partition names;
// observations are never printed or saved. A small run memory file keeps listing
// ids and two facts, so listing pages read recently are not requested again and
// two live reads cannot start close together.
async function live(values: Values) {
  if (values.source === undefined || !LIVE_SOURCES.includes(values.source))
    throw new Error(
      'Live reading exists for boneo, bjurfors, erik-olsson, stadshem, lundin, husman-hagberg and svenskfast only.',
    );
  if (!values['confirm-personal-read'])
    throw new Error('Live reading needs --confirm-personal-read.');
  if (values.at !== undefined)
    throw new Error('Live reads use the fetch time; --at does not apply.');
  const capability = sourceRegistry().find(
    (entry) => entry.source.sourceId === values.source,
  );
  if (!capability) throw new Error('Unknown source.');
  // The planner reads only the municipality and home types from this; collector bounds decide what is kept.
  const profiles = [
    {
      id: '00000000-0000-4000-8000-000000000000',
      revision: 1,
      enabled: true,
      criteria: fixtureCriteria([COLLECTOR_MUNICIPALITY]),
    },
  ];
  // Checked before the read so a bad environment costs no requests to the source.
  const sender = values.send ? senderConfig(process.env) : null;
  adapterFor(capability);
  // Refuses a too-soon run here and records this one, before any request.
  const cachePath = resolve(values.cache ?? DEFAULT_CACHE_PATH);
  const memory = startLiveRun(cachePath, Date.now(), values.force);
  const geocodePath = resolve(GEOCODE_CACHE_PATH);
  const geocodeCache = loadGeocodeCache(geocodePath);
  const soldPoolPath = resolve(SOLD_POOL_PATH);
  const soldPool = loadSoldPool(soldPoolPath);
  const events: LiveEvent[] = [];
  const prepared = await prepareLiveRun(
    {
      runId: values['run-id'],
      batchId: values['batch-id'],
      capability,
      planning: { profiles, collectionPriceCapSek: null, maxPartitions: 5 },
      memory,
      geocodeCache,
      soldPool,
    },
    defaultLiveDeps((event) => events.push(event)),
  );
  let cacheSaved = true;
  try {
    saveMemory(cachePath, memory.memory, Date.now());
  } catch {
    cacheSaved = false;
  }
  try {
    saveGeocodeCache(geocodePath, geocodeCache);
    saveSoldPool(soldPoolPath, soldPool);
  } catch {
    cacheSaved = false;
  }
  const delivery = sender
    ? await sendRequests(prepared.requests, sender)
    : null;
  console.info(
    JSON.stringify(
      {
        mode: prepared.mode,
        liveCoverage: false,
        notice: delivery
          ? 'Partial personal read, sent to the ingest function. Nothing saved locally.'
          : 'Partial personal read. Nothing sent or saved; the source is not approved.',
        publishStatus: prepared.publishStatus,
        stopped: prepared.result.stopped,
        requestCount: prepared.result.requestCount,
        detailRead: prepared.result.detailRead,
        detailFailed: prepared.result.detailFailed,
        detailSkipped: prepared.result.detailSkipped,
        detailCached: prepared.result.detailCached,
        ...(prepared.cacheReset ? { cacheReset: true } : {}),
        ...(cacheSaved ? {} : { cacheSaved: false }),
        collectedCount: prepared.result.observations.length,
        observationCount: prepared.prefilter.kept,
        droppedByReason: prepared.prefilter.dropped,
        stageRequestCount: prepared.requests.filter(
          (request) => request.action === 'stage',
        ).length,
        partitions: prepared.result.partitions,
        delivery,
        events,
      },
      null,
      2,
    ),
  );
  if (delivery?.stopped) process.exitCode = 1;
}

// A one-off read of the sold lists into the local sold pool, run by hand. Nothing is sent.
async function sold(values: Values) {
  if (!values['confirm-personal-read'])
    throw new Error('Reading sold lists needs --confirm-personal-read.');
  if (values.live || values.send)
    throw new Error('--sold runs on its own, without --live or --send.');
  const path = resolve(SOLD_POOL_PATH);
  const pool = loadSoldPool(path);
  const shapes = loadNeighbourhoodShapes(resolve(NEIGHBOURHOODS_PATH));
  const reports = await collectSold(pool, shapes, {
    fetch,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: Date.now,
    random: Math.random,
  });
  saveSoldPool(path, pool);
  console.info(
    JSON.stringify(
      { mode: 'sold-read', neighbourhoods: shapes.length, reports },
      null,
      2,
    ),
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string', default: 'fixture' },
      source: { type: 'string', default: DEMO_SOURCE_ID },
      at: { type: 'string' },
      'run-id': { type: 'string' },
      'batch-id': { type: 'string' },
      live: { type: 'boolean', default: false },
      'confirm-personal-read': { type: 'boolean', default: false },
      // shortcut: accepted and ignored so older run scripts keep working; remove once run-collector.ps1 drops it.
      profiles: { type: 'string' },
      send: { type: 'boolean', default: false },
      'confirm-send': { type: 'boolean', default: false },
      cache: { type: 'string' },
      force: { type: 'boolean', default: false },
      sold: { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.sold) return sold(values);
  if (values.mode !== 'fixture') throw new Error('Only fixture mode exists.');
  if (values['confirm-personal-read'] && !values.live)
    throw new Error('The confirmation flag applies to live reads only.');
  if ((values.cache !== undefined || values.force) && !values.live)
    throw new Error('--cache and --force apply to live reads only.');
  if (values.send !== values['confirm-send'])
    throw new Error('Sending needs --send and --confirm-send together.');
  if (values.send && !values.live)
    throw new Error('Sending applies to live reads only.');
  if (values.live) return live(values);
  const capability = sourceRegistry().find(
    (entry) => entry.source.sourceId === values.source,
  );
  if (!capability) throw new Error('Unknown source.');
  const criteria = fixtureCriteria(['Example municipality']);
  const prepared = prepareFixtureRun({
    runId: values['run-id'] ?? '00000000-0000-4000-8000-000000000101',
    batchId: values['batch-id'] ?? '00000000-0000-4000-8000-000000000102',
    at: values.at ?? '2026-10-12T12:00:00Z',
    capability,
    planning: {
      profiles: [
        {
          id: '00000000-0000-4000-8000-000000000103',
          revision: 1,
          enabled: true,
          criteria,
        },
      ],
      collectionPriceCapSek: null,
      maxPartitions: 100,
    },
  });
  // Payloads stay in memory. Logs contain no listing snapshots or private input.
  console.info(
    JSON.stringify(
      {
        mode: prepared.mode,
        liveCoverage: prepared.liveCoverage,
        notice:
          'No live coverage. Unsigned requests prepared in memory; nothing sent or saved.',
        observationCount: prepared.requests.reduce(
          (count, request) =>
            count +
            (request.action === 'stage' ? request.observations.length : 0),
          0,
        ),
        requestCount: prepared.requests.length,
        partitionCount: prepared.queryPlan.partitions.length,
        candidateSourceCount: sourceRegistry().filter(
          (entry) => entry.executor === 'none',
        ).length,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify({
      status: 'rejected',
      category:
        error instanceof z.ZodError
          ? 'invalid-input'
          : error instanceof RunTooSoonError
            ? 'run-interval'
            : 'permission-or-configuration',
      notice:
        error instanceof RunTooSoonError
          ? error.message
          : 'Collector did not send or save data. Review fixture options and source permission.',
    }),
  );
  process.exitCode = 1;
}
