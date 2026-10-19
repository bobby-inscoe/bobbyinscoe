import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LiveDeps, LiveEvent } from '@house-scanner-tools/live-reader';
import { vi } from 'vitest';

// A scripted fetch and a fake clock for the guarded reader. The clock only moves when the reader sleeps.
export type Reply = { status?: number; body?: string; type?: string } | Error;
export function fakeFetch(handler: (url: string, call: number) => Reply) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const reply = handler(url, calls.length);
    if (reply instanceof Error) throw reply;
    return new Response(reply.body ?? '', {
      status: reply.status ?? 200,
      headers: { 'content-type': reply.type ?? 'text/html; charset=utf-8' },
    });
  });
  return { impl, calls, spy: impl };
}
export function deps(
  fetchImpl: typeof fetch,
  events: LiveEvent[] = [],
  random: () => number = () => 0,
): LiveDeps {
  let clock = 0;
  return {
    fetch: fetchImpl,
    now: () => 1_760_000_000_000 + clock,
    random,
    sleep: async (ms) => {
      clock += ms;
    },
    log: (event) => events.push(event),
  };
}

export const boneoFixture = (name: string) =>
  readFileSync(resolve('tools/house-scanner/fixtures/boneo', name), 'utf8');
const BONEO_ROBOTS = boneoFixture('robots.txt');
export const boneoRobotsOr =
  (page: (url: string, n: number) => Reply) =>
  (url: string, n: number): Reply =>
    url.endsWith('/robots.txt')
      ? { body: BONEO_ROBOTS, type: 'text/plain' }
      : page(url, n);

export function nextPage(ids: number[], count: number) {
  const items = ids.map((id) => ({
    property_id: id,
    slug: `https://www.boneo.se/bostad/fixture-${id}`,
    title_field: `Fixturegatan ${id}`,
    created_date: '2026-09-30T08:00:00.000Z',
    field_status_id: 'Till salu',
    is_active: true,
    field_property_price: 3_000_000,
  }));
  return `<script id="__NEXT_DATA__">${JSON.stringify({
    props: { pageProps: { listData: { pData: items, count } } },
  })}</script>`;
}
