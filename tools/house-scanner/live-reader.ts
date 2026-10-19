import {
  MAX_RUN_OBSERVATIONS,
  sourceIdentity,
} from '@house-scanner-tools/collector';
import {
  type PageRead,
  positionPrecision,
  type ReadContext,
} from '@house-scanner-tools/page-read';
import { parseRobots, robotsAllows } from '@house-scanner-tools/robots';
import {
  type DetailFacts,
  freshDetail,
  type RunMemory,
} from '@house-scanner-tools/run-memory';
import type { SourceCapability } from '@house-scanner-tools/source-registry';
import { finishViewings } from '@house-scanner-tools/viewing-time';
import type { Observation } from '@/features/house-scanner/types/contracts';

export const USER_AGENT =
  'HouseScannerPersonalReader/0.1 (private household tool)';
// Each gap is drawn per request between these, so requests do not land in lockstep.
export const MIN_INTERVAL_MS = 2000;
export const MAX_INTERVAL_MS = 4000;
export const MAX_PAGES_PER_PARTITION = 40;
export const MAX_REQUESTS_PER_RUN = 250;
export const MAX_DETAIL_PAGES_PER_RUN = 150;
export const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_BODY_CHARS = 3_000_000;

// A listing page that fails for any other reason only costs that listing's extra facts.
const STOPS_RUN: StopReason[] = [
  'http-403',
  'http-429',
  'network-error',
  'timeout',
];

export type StopReason =
  | 'robots-unavailable'
  | 'robots-disallow'
  | 'request-cap'
  | 'http-429'
  | 'http-403'
  | 'http-non-200'
  | 'network-error'
  | 'timeout'
  | 'not-html'
  | 'oversize'
  | 'no-embedded-data'
  | 'no-results-list'
  | 'invalid-embedded-data'
  | 'unexpected-shape'
  | 'inconsistent-count'
  | 'too-large';

export type PartitionStatus =
  | 'read'
  | 'truncated'
  | 'failed'
  | 'unsupported'
  | 'not-executed';

export interface LivePartitionInput {
  id: string;
  municipality: string;
  propertyTypes: readonly ('apartment' | 'house')[];
}

export interface PartitionOutcome {
  id: string;
  municipality: string;
  status: PartitionStatus;
  pages: number;
  observations: number;
  skipped: number;
  total: number | null;
  reason: string | null;
}

export interface LiveEvent {
  event: string;
  partition?: string;
  status?: number;
  count?: number;
  reason?: string;
}

export interface LiveDeps {
  fetch: typeof fetch;
  now: () => number;
  // A number in [0, 1] that sizes each gap between requests: 0 gives the minimum, 1 the maximum.
  random: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (event: LiveEvent) => void;
}

export function defaultLiveDeps(log: (event: LiveEvent) => void): LiveDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    random: () => Math.random(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log,
  };
}

/** What differs between sources. Robots, pacing, caps, stop rules, run memory and the detail phase are shared. */
export interface SourceAdapter {
  sourceId: string;
  executor: SourceCapability['executor'];
  origin: string;
  imageOrigin: string;
  headers: Record<string, string>;
  // Label for a coordinate this source's listing pages supply.
  coordinateSource: string;
  // Sentence parts for the coverage note.
  detailLabel: string;
  notCovered: string;
  /** First page of a partition, or why the partition cannot be read. */
  partitionUrl(partition: LivePartitionInput): string | { unsupported: string };
  /** Set when the search page already carries everything the source can give, so no home page is read. */
  listOnly?: boolean;
  /** Where a listing's extra facts are read, when that is not the page people open. */
  detailUrl?(observation: Observation): string;
  /** The photo a listing page's facts point to, for a source whose photos sit on an image host. */
  photoFor?(facts: DetailFacts, observedAt: string): Observation['photo'];
  /** URL of a later page. Without it the page number is added as ?page=N. */
  pageUrl?(base: string, page: number): string;
  readSearchPage(html: string, context: ReadContext): PageRead;
  readDetailPage(
    html: string,
    now: Date,
  ):
    | { kind: 'detail'; facts: DetailFacts }
    | { kind: 'failed'; reason: StopReason };
}

/** Merges what a listing page supplied; unknown and missing values never overwrite. */
function applyDetail(
  adapter: SourceAdapter,
  observation: Observation,
  detail: DetailFacts,
  now: Date,
) {
  const {
    latitude,
    longitude,
    photoPath: _photoPath,
    viewings,
    ...facts
  } = detail;
  Object.assign(
    observation.facts,
    Object.fromEntries(
      Object.entries(facts).filter(
        ([, value]) =>
          value !== undefined && value !== null && value !== 'unknown',
      ),
    ),
  );
  const photo = adapter.photoFor?.(detail, observation.observedAt);
  if (photo) observation.photo = photo;
  // A page that lists viewings replaces what the search gave; one that lists none leaves it alone.
  const upcoming = viewings ? finishViewings(viewings, now) : undefined;
  if (upcoming) observation.viewings = upcoming;
  if (latitude === undefined || longitude === undefined) return;
  observation.coordinates = {
    latitude,
    longitude,
    precision: positionPrecision(observation.title),
    source: adapter.coordinateSource,
    observedAt: observation.observedAt,
  };
}

export interface LiveRunResult {
  observations: Observation[];
  partitions: PartitionOutcome[];
  requestCount: number;
  detailRead: number;
  detailFailed: number;
  detailSkipped: number;
  detailCached: number;
  stopped: StopReason | null;
}

export async function runCollection(
  adapter: SourceAdapter,
  partitions: readonly LivePartitionInput[],
  deps: LiveDeps,
  // Picks the observations whose own listing page is read for outdoor and glazed.
  selectKept: (observations: Observation[]) => Observation[] = () => [],
  // Listing pages read recently are merged from here instead of requested again.
  memory: RunMemory | null = null,
): Promise<LiveRunResult> {
  let requestCount = 0;
  let detailRead = 0;
  let detailFailed = 0;
  let detailSkipped = 0;
  let detailCached = 0;
  let lastFinishedAt: number | null = null;
  const observations: Observation[] = [];
  const seen = new Set<string>();
  const outcomes: PartitionOutcome[] = partitions.map((partition) => ({
    id: partition.id,
    municipality: partition.municipality,
    status: 'not-executed',
    pages: 0,
    observations: 0,
    skipped: 0,
    total: null,
    reason: null,
  }));

  type Fetched =
    | { ok: true; status: number; body: string }
    | { ok: false; stop: StopReason; status?: number };

  async function request(url: string): Promise<Fetched> {
    if (requestCount >= MAX_REQUESTS_PER_RUN)
      return { ok: false, stop: 'request-cap' };
    if (lastFinishedAt !== null) {
      const gap =
        MIN_INTERVAL_MS + deps.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
      const wait = gap - (deps.now() - lastFinishedAt);
      if (wait > 0) await deps.sleep(wait);
    }
    requestCount += 1;
    let response: Response;
    let body: string;
    try {
      response = await deps.fetch(url, {
        method: 'GET',
        headers: adapter.headers,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const declared = Number(response.headers.get('content-length'));
      if (declared > MAX_BODY_CHARS) {
        lastFinishedAt = deps.now();
        return { ok: false, stop: 'oversize', status: response.status };
      }
      body = await response.text();
    } catch (error) {
      lastFinishedAt = deps.now();
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return { ok: false, stop: timedOut ? 'timeout' : 'network-error' };
    }
    lastFinishedAt = deps.now();
    if (response.status === 429)
      return { ok: false, stop: 'http-429', status: 429 };
    if (response.status === 403)
      return { ok: false, stop: 'http-403', status: 403 };
    if (response.status !== 200)
      return { ok: false, stop: 'http-non-200', status: response.status };
    if (body.length > MAX_BODY_CHARS)
      return { ok: false, stop: 'oversize', status: 200 };
    return { ok: true, status: 200, body };
  }

  function finish(stopped: StopReason | null): LiveRunResult {
    deps.log({
      event: 'run-finished',
      count: observations.length,
      reason: stopped ?? 'none',
    });
    return {
      observations,
      partitions: outcomes,
      requestCount,
      detailRead,
      detailFailed,
      detailSkipped,
      detailCached,
      stopped,
    };
  }

  const robotsUrl = `${adapter.origin}/robots.txt`;
  const robotsResponse = await request(robotsUrl);
  deps.log({
    event: 'robots',
    status: robotsResponse.ok ? 200 : robotsResponse.status,
  });
  if (!robotsResponse.ok) return finish('robots-unavailable');
  const robots = parseRobots(robotsResponse.body);

  for (const [index, partition] of partitions.entries()) {
    const outcome = outcomes[index];
    const base = adapter.partitionUrl(partition);
    if (typeof base !== 'string') {
      outcome.status = 'unsupported';
      outcome.reason = base.unsupported;
      deps.log({ event: 'partition-unsupported', partition: partition.id });
      continue;
    }
    for (let page = 1; page <= MAX_PAGES_PER_PARTITION; page += 1) {
      const url =
        page === 1
          ? base
          : (adapter.pageUrl?.(base, page) ?? `${base}?page=${page}`);
      const parsedUrl = new URL(url);
      if (!robotsAllows(robots, `${parsedUrl.pathname}${parsedUrl.search}`)) {
        outcome.status = 'failed';
        outcome.reason = 'robots-disallow';
        deps.log({ event: 'robots-disallow', partition: partition.id });
        return finish('robots-disallow');
      }
      const fetched = await request(url);
      if (!fetched.ok) {
        outcome.status = 'failed';
        outcome.reason = fetched.stop;
        deps.log({
          event: 'request-stopped',
          partition: partition.id,
          status: fetched.status,
          reason: fetched.stop,
        });
        return finish(fetched.stop);
      }
      outcome.pages = page;
      const read = adapter.readSearchPage(fetched.body, {
        origin: adapter.origin,
        observedAt: new Date(deps.now()),
        receivedBefore: outcome.observations + outcome.skipped,
        municipality: partition.municipality,
      });
      if (read.kind === 'failed') {
        // A page without usable data is failed coverage, never an empty result.
        outcome.status = 'failed';
        outcome.reason = read.reason;
        deps.log({
          event: 'page-failed',
          partition: partition.id,
          status: 200,
          reason: read.reason,
        });
        return finish(read.reason);
      }
      const room = MAX_RUN_OBSERVATIONS - observations.length;
      const fresh = read.observations.filter((observation) => {
        const key = sourceIdentity(adapter.sourceId, observation);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const taken = fresh.slice(0, room);
      observations.push(...taken);
      outcome.observations += taken.length;
      outcome.skipped +=
        read.skipped + (read.observations.length - taken.length);
      outcome.total = read.total;
      deps.log({
        event: 'page-read',
        partition: partition.id,
        status: 200,
        count: taken.length,
      });
      if (read.more.kind === 'none') {
        outcome.status = 'read';
        break;
      }
      if (taken.length < fresh.length || room - taken.length <= 0) {
        outcome.status = 'truncated';
        outcome.reason = 'observation-cap';
        break;
      }
      if (read.more.kind === 'unknown') {
        outcome.status = 'truncated';
        outcome.reason = read.more.reason;
        break;
      }
      if (page === MAX_PAGES_PER_PARTITION) {
        outcome.status = 'truncated';
        outcome.reason = 'page-cap';
      }
    }
  }

  // One request per kept listing, under the same guards, unless the run memory
  // holds a recent read. A failed page leaves that listing's outdoor and glazed
  // unknown and is never remembered; 403, 429 and network errors still stop the
  // whole run.
  const targets = adapter.listOnly ? [] : selectKept(observations);
  for (const observation of targets) {
    const detailUrl = adapter.detailUrl?.(observation) ?? observation.sourceUrl;
    const url = new URL(detailUrl);
    if (!robotsAllows(robots, `${url.pathname}${url.search}`)) {
      detailSkipped += 1;
      continue;
    }
    const cached = memory
      ? freshDetail(memory, observation.sourceListingId, deps.now())
      : undefined;
    if (cached) {
      const { readAt: _readAt, ...stored } = cached;
      applyDetail(adapter, observation, stored, new Date(deps.now()));
      detailCached += 1;
      continue;
    }
    if (detailRead + detailFailed >= MAX_DETAIL_PAGES_PER_RUN) {
      detailSkipped += 1;
      continue;
    }
    const fetched = await request(detailUrl);
    if (!fetched.ok) {
      if (fetched.stop === 'request-cap') {
        detailSkipped += 1;
        continue;
      }
      deps.log({
        event: 'detail-failed',
        status: fetched.status,
        reason: fetched.stop,
      });
      if (STOPS_RUN.includes(fetched.stop)) return finish(fetched.stop);
      detailFailed += 1;
      continue;
    }
    const detail = adapter.readDetailPage(fetched.body, new Date(deps.now()));
    if (detail.kind === 'failed') {
      deps.log({ event: 'detail-failed', status: 200, reason: detail.reason });
      detailFailed += 1;
      continue;
    }
    applyDetail(adapter, observation, detail.facts, new Date(deps.now()));
    if (memory)
      memory.details[observation.sourceListingId] = {
        ...detail.facts,
        readAt: new Date(deps.now()).toISOString(),
      };
    detailRead += 1;
  }
  return finish(null);
}
