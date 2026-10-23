import { readErikOlssonSoldPage } from '@house-scanner-tools/erik-olsson-parser';
import {
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  USER_AGENT,
} from '@house-scanner-tools/live-reader';
import type { ModelRow, SoldPage } from '@house-scanner-tools/price-model';
import { parseRobots, robotsAllows } from '@house-scanner-tools/robots';
import {
  refreshPriceModel,
  type Shape,
  type SoldPool,
} from '@house-scanner-tools/sold-pool';
import {
  ERIK_OLSSON_ORIGIN,
  ERIK_OLSSON_SOURCE_ID,
  STADSHEM_ORIGIN,
  STADSHEM_SOURCE_ID,
} from '@house-scanner-tools/source-registry';
import { readStadshemSoldPage } from '@house-scanner-tools/stadshem-parser';

// A one-off read of sold apartments with final prices, run by hand (spec: house-scanner-price-estimates, S2b/S2d).
// It is not part of a collector run. Each list is read newest first, under robots.txt and the run's 1 to 2 second
// pacing, until a page reaches back two years, adds nothing new, is the last, or the page cap is hit. Rows go into the
// local sold pool; nothing is sent.
export const MAX_SOLD_PAGES = 40;
const BACK_MS = 2 * 365 * 24 * 60 * 60 * 1000;

interface SoldList {
  sourceId: string;
  origin: string;
  url(page: number): string;
  headers: Record<string, string>;
  read(body: string): SoldPage | null;
}

export const SOLD_LISTS: SoldList[] = [
  {
    sourceId: STADSHEM_SOURCE_ID,
    origin: STADSHEM_ORIGIN,
    // The reader keeps Göteborg and Mölndal apartments.
    url: (page) =>
      `${STADSHEM_ORIGIN}/api/estates?per_page=100&orderby=published&order=desc&status[]=sald&page=${page + 1}`,
    headers: { accept: 'application/json' },
    read: readStadshemSoldPage,
  },
  {
    sourceId: ERIK_OLSSON_SOURCE_ID,
    origin: ERIK_OLSSON_ORIGIN,
    // The Göteborg municipality page; `rsc: 1` asks for the component text that holds the list rows.
    url: (page) =>
      `${ERIK_OLSSON_ORIGIN}/municipalities/goteborg-166?tab=homes&categories=apartment&statuses=sold&limit=100&page=${page}`,
    headers: { accept: '*/*', rsc: '1' },
    read: readErikOlssonSoldPage,
  },
];

export interface SoldDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
}

export interface SoldReport {
  sourceId: string;
  pages: number;
  rows: number;
  stopped: string;
}

/** Reads every sold list into the pool and returns what each read. */
export async function collectSold(
  pool: SoldPool,
  shapes: Shape[],
  deps: SoldDeps,
  lists: SoldList[] = SOLD_LISTS,
  maxPages = MAX_SOLD_PAGES,
): Promise<SoldReport[]> {
  const reports: SoldReport[] = [];
  let first = true;
  const get = async (url: string, headers: Record<string, string>) => {
    if (!first)
      await deps.sleep(
        MIN_INTERVAL_MS + deps.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS),
      );
    first = false;
    const response = await deps.fetch(url, {
      headers: { 'user-agent': USER_AGENT, ...headers },
      redirect: 'manual',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    return { status: response.status, body: await response.text() };
  };
  for (const list of lists) {
    const rows: Record<string, ModelRow> = {};
    const since = new Date(deps.now() - BACK_MS).toISOString();
    let pages = 0;
    let stopped = 'page-cap';
    try {
      const robots = await get(`${list.origin}/robots.txt`, {});
      const rules = parseRobots(robots.status === 200 ? robots.body : '');
      for (let page = 0; page < maxPages; page += 1) {
        const url = new URL(list.url(page));
        if (
          robots.status !== 200 ||
          !robotsAllows(rules, `${url.pathname}${url.search}`)
        ) {
          stopped = 'robots';
          break;
        }
        const fetched = await get(url.href, list.headers);
        if (fetched.status !== 200) {
          stopped = `http-${fetched.status}`;
          break;
        }
        const read = list.read(fetched.body);
        if (read === null) {
          stopped = 'unexpected-shape';
          break;
        }
        pages += 1;
        const before = Object.keys(rows).length;
        Object.assign(rows, read.rows);
        if (read.last || Object.keys(rows).length === before) {
          stopped = 'end';
          break;
        }
        if (read.oldest !== null && read.oldest < since) {
          stopped = 'two-years';
          break;
        }
      }
    } catch {
      stopped = 'network-error';
    }
    refreshPriceModel(pool, list.sourceId, rows, new Date(deps.now()), {
      manual: true,
      shapes,
    });
    reports.push({
      sourceId: list.sourceId,
      pages,
      rows: Object.keys(rows).length,
      stopped,
    });
  }
  return reports;
}
