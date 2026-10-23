import {
  readErikOlssonSaleDate,
  readErikOlssonSoldPage,
} from '@house-scanner-tools/erik-olsson-parser';
import {
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  USER_AGENT,
} from '@house-scanner-tools/live-reader';
import {
  type ModelRow,
  periodOf,
  type SoldPage,
} from '@house-scanner-tools/price-model';
import { parseRobots, robotsAllows } from '@house-scanner-tools/robots';
import {
  poolKey,
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
// pacing, until a page reaches back two years, adds nothing new, holds only sales the pool already has (so a later
// read fetches only the newest pages), is the last, or the page cap is hit. Rows go into the
// local sold pool; nothing is sent.
// A list sorted by sale date but without dates (Erik Olsson) is dated from anchors: the first home of every fifth page
// and the last home read are opened for their sale date, and every row gets a date interpolated from its place
// between them, marked estimated. Sampled on 23 October 2026, the list ran steadily from October 2026 (page 1) to
// September 2022 (page 39), about 100 sales a month, so the estimate is good to a few weeks.
export const MAX_SOLD_PAGES = 40;
export const ANCHOR_EVERY = 5;
const BACK_MS = 2 * 365 * 24 * 60 * 60 * 1000;

interface SoldList {
  sourceId: string;
  origin: string;
  url(page: number): string;
  headers: Record<string, string>;
  read(body: string): SoldPage | null;
  // Dates a list without sale dates from a few homes' own pages.
  anchor?: { url(id: string): string; date(body: string): string | null };
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
    anchor: {
      url: (id) => `${ERIK_OLSSON_ORIGIN}/homes/x-${id}`,
      date: readErikOlssonSaleDate,
    },
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
  // Homes opened to date the list.
  anchors: number;
}

interface Anchor {
  at: number;
  time: number;
}

/** Gives every row a date interpolated from its place in `order` between the anchors (clamped at the ends). */
export function dateByPlace(
  rows: Record<string, ModelRow>,
  order: string[],
  anchors: Anchor[],
) {
  if (anchors.length === 0) return;
  const sorted = [...anchors].sort((a, b) => a.at - b.at);
  order.forEach((id, at) => {
    const row = rows[id];
    if (!row) return;
    const next = sorted.findIndex((a) => a.at >= at);
    const [a, b] =
      next === -1
        ? [sorted.at(-1), sorted.at(-1)]
        : next === 0
          ? [sorted[0], sorted[0]]
          : [sorted[next - 1], sorted[next]];
    if (!a || !b) return;
    const time =
      a.at === b.at
        ? a.time
        : a.time + ((b.time - a.time) * (at - a.at)) / (b.at - a.at);
    const soldOn = new Date(time).toISOString().slice(0, 10);
    rows[id] = {
      ...row,
      soldOn,
      soldOnEstimated: true,
      period: periodOf(soldOn) ?? row.period,
    };
  });
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
    const order: string[] = [];
    const anchors: Anchor[] = [];
    const since = new Date(deps.now() - BACK_MS).toISOString();
    const known = new Set(Object.keys(pool[list.sourceId]?.rows ?? {}));
    let pages = 0;
    let stopped = 'page-cap';
    try {
      const robots = await get(`${list.origin}/robots.txt`, {});
      const rules = parseRobots(robots.status === 200 ? robots.body : '');
      // The sale date of the home at this place in the list, or null when its page is refused or carries none.
      const anchorAt = async (at: number) => {
        const id = order[at];
        if (!list.anchor || id === undefined) return null;
        const url = new URL(list.anchor.url(id));
        if (!robotsAllows(rules, `${url.pathname}${url.search}`)) return null;
        const fetched = await get(url.href, list.headers);
        const date =
          fetched.status === 200 ? list.anchor.date(fetched.body) : null;
        if (date) anchors.push({ at, time: Date.parse(`${date}T12:00:00Z`) });
        return date;
      };
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
        const first = order.length;
        order.push(...read.ids.filter((id) => !order.includes(id)));
        Object.assign(rows, read.rows);
        if (read.last || Object.keys(rows).length === before) {
          stopped = 'end';
          break;
        }
        const kept = Object.keys(read.rows);
        if (
          kept.length > 0 &&
          kept.every((id) => known.has(poolKey(list.sourceId, id)))
        ) {
          stopped = 'known';
          break;
        }
        const anchored =
          page % ANCHOR_EVERY === 0 ? await anchorAt(first) : null;
        if (
          (read.oldest !== null && read.oldest < since) ||
          (anchored !== null && anchored < since)
        ) {
          stopped = 'two-years';
          break;
        }
      }
      // Sales already in the pool keep the values and dates they were stored with.
      for (const id of Object.keys(rows))
        if (known.has(poolKey(list.sourceId, id))) delete rows[id];
      const lastNew = order.findLastIndex((id) => rows[id] !== undefined);
      if (list.anchor && lastNew >= 0) await anchorAt(lastNew);
    } catch {
      stopped = 'network-error';
    }
    dateByPlace(rows, order, anchors);
    // Rows dated before the two years, found when the last page reached past them, are left out.
    for (const [id, row] of Object.entries(rows))
      if (row.soldOn && row.soldOn < since.slice(0, 10)) delete rows[id];
    refreshPriceModel(pool, list.sourceId, rows, new Date(deps.now()), {
      manual: true,
      shapes,
    });
    reports.push({
      sourceId: list.sourceId,
      pages,
      rows: Object.keys(rows).length,
      stopped,
      anchors: anchors.length,
    });
  }
  return reports;
}
