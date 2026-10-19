import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runCollection } from '@house-scanner-tools/live-reader';
import {
  DETAIL_TTL_MS,
  freshDetail,
  loadMemory,
  MAX_MEMORY_BYTES,
  MAX_MEMORY_ENTRIES,
  MEMORY_MAX_AGE_MS,
  MIN_RUN_INTERVAL_MS,
  type RunMemory,
  RunTooSoonError,
  saveMemory,
  startLiveRun,
} from '@house-scanner-tools/run-memory';
import { boneoAdapter } from '@house-scanner-tools/source-adapters';
import { describe, expect, it, vi } from 'vitest';

const failWrite = vi.hoisted(() => ({ on: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    // A failing write leaves half a file behind, like a full disk would.
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (failWrite.on) {
        actual.writeFileSync(args[0], '{"version":1,"last');
        throw new Error('disk full');
      }
      return actual.writeFileSync(...args);
    },
  };
});

const NOW = Date.parse('2026-10-16T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ago: number) => new Date(NOW - ago).toISOString();
const entry = (ago: number) => ({
  outdoor: 'balcony' as const,
  glazed: true,
  readAt: at(ago),
});
const memoryWith = (
  details: RunMemory['details'],
  lastLiveRunAt: string | null = null,
): RunMemory => ({ version: 1, lastLiveRunAt, details });
const tempFile = () =>
  join(mkdtempSync(join(tmpdir(), 'hs-memory-')), 'c.json');
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

describe('loading', () => {
  it('treats a missing file as empty memory without reporting a reset', () => {
    expect(loadMemory(tempFile())).toEqual({
      memory: memoryWith({}),
      reset: false,
    });
  });

  it('reads back what was saved', () => {
    const path = tempFile();
    const memory = memoryWith({ '7': entry(DAY) }, at(HOUR));
    saveMemory(path, memory, NOW);
    expect(loadMemory(path)).toEqual({ memory, reset: false });
  });

  const listingFacts = {
    ...entry(DAY),
    groundFloor: false,
    lift: true,
    propertyType: 'apartment' as const,
    tenure: 'cooperative' as const,
    status: 'available' as const,
    baseFeeSek: 3997,
    askingPriceSek: 3_250_000,
    livingAreaM2: 62,
    rooms: 2,
    latitude: 57.7,
    longitude: 11.9,
  };
  it('reads entries with the listing page facts, and old entries without them', () => {
    const path = tempFile();
    const memory = memoryWith({ a: listingFacts, '7': entry(DAY) });
    saveMemory(path, memory, NOW);
    expect(loadMemory(path)).toEqual({ memory, reset: false });
  });

  const tooMany = Object.fromEntries(
    Array.from({ length: MAX_MEMORY_ENTRIES + 1 }, (_v, i) => [
      String(i),
      entry(DAY),
    ]),
  );
  it.each([
    ['corrupt json', '{"version":1,'],
    ['not an object', '[]'],
    ['wrong version', JSON.stringify({ ...memoryWith({}), version: 2 })],
    [
      'extra top-level key',
      JSON.stringify({ ...memoryWith({}), note: 'https://x' }),
    ],
    [
      'extra entry key',
      JSON.stringify({
        ...memoryWith({}),
        details: { '1': { ...entry(DAY), title: 'x' } },
      }),
    ],
    [
      'bad fact value',
      JSON.stringify({
        ...memoryWith({}),
        details: { '1': { ...entry(DAY), outdoor: 'pool' } },
      }),
    ],
    ['bad timestamp', JSON.stringify(memoryWith({}, 'yesterday'))],
    [
      'a latitude out of range',
      JSON.stringify({
        ...memoryWith({}),
        details: { '1': { ...listingFacts, latitude: 91 } },
      }),
    ],
    [
      'a text value where a number belongs',
      JSON.stringify({
        ...memoryWith({}),
        details: { '1': { ...listingFacts, baseFeeSek: 'about 4000' } },
      }),
    ],
    [
      'an address key beside the listing page facts',
      JSON.stringify({
        ...memoryWith({}),
        details: { '1': { ...listingFacts, address: 'Exempelgatan 1' } },
      }),
    ],
    ['too many entries', JSON.stringify(memoryWith(tooMany))],
    [
      'oversize file',
      JSON.stringify(memoryWith({})) + ' '.repeat(MAX_MEMORY_BYTES),
    ],
  ])('resets on %s and does not throw', (_name, text) => {
    const path = tempFile();
    writeFileSync(path, text);
    expect(loadMemory(path)).toEqual({ memory: memoryWith({}), reset: true });
  });
});

describe('saving', () => {
  it('drops entries older than 30 days and keeps the newest 5000', () => {
    const path = tempFile();
    const details: RunMemory['details'] = {};
    for (let i = 0; i < MAX_MEMORY_ENTRIES + 1; i += 1)
      details[`n${i}`] = entry(DAY + i);
    saveMemory(path, memoryWith(details), NOW);
    const saved = read(path).details;
    expect(Object.keys(saved)).toHaveLength(MAX_MEMORY_ENTRIES);
    expect(saved.n0).toBeDefined();
    // the oldest of the surplus is the one cut
    expect(saved[`n${MAX_MEMORY_ENTRIES}`]).toBeUndefined();
  });

  it('keeps an entry just inside 30 days and drops one just outside', () => {
    const path = tempFile();
    saveMemory(
      path,
      memoryWith({
        a: entry(MEMORY_MAX_AGE_MS - 1),
        b: entry(MEMORY_MAX_AGE_MS + 1),
      }),
      NOW,
    );
    expect(Object.keys(read(path).details)).toEqual(['a']);
  });

  it('is atomic: a failed write leaves the old file whole and no temp file', () => {
    const path = tempFile();
    saveMemory(path, memoryWith({ '1': entry(DAY) }, at(HOUR)), NOW);
    const before = readFileSync(path, 'utf8');
    failWrite.on = true;
    try {
      expect(() =>
        saveMemory(path, memoryWith({ '2': entry(0) }, at(0)), NOW),
      ).toThrow('disk full');
    } finally {
      failWrite.on = false;
    }
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(readdirSync(dirname(path))).toEqual(['c.json']);
  });

  it('leaves no file at all when the first write fails', () => {
    const path = tempFile();
    failWrite.on = true;
    try {
      expect(() => saveMemory(path, memoryWith({}), NOW)).toThrow();
    } finally {
      failWrite.on = false;
    }
    expect(readdirSync(dirname(path))).toEqual([]);
  });
});

describe('fresh details', () => {
  const memory = memoryWith({
    young: entry(DETAIL_TTL_MS - 1),
    exact: entry(DETAIL_TTL_MS),
    future: entry(-1),
  });
  it('uses an entry younger than 7 days only', () => {
    expect(DETAIL_TTL_MS).toBe(7 * DAY);
    expect(freshDetail(memory, 'young', NOW)).toBeDefined();
    expect(freshDetail(memory, 'exact', NOW)).toBeUndefined();
    expect(freshDetail(memory, 'future', NOW)).toBeUndefined();
    expect(freshDetail(memory, 'absent', NOW)).toBeUndefined();
    expect(freshDetail(memory, 'constructor', NOW)).toBeUndefined();
  });
});

describe('run interval guard', () => {
  const stamped = (ago: number) => {
    const path = tempFile();
    saveMemory(path, memoryWith({ '1': entry(DAY) }, at(ago)), NOW);
    return path;
  };

  it('starts a first run and records when it started', () => {
    const path = tempFile();
    expect(startLiveRun(path, NOW, false).reset).toBe(false);
    expect(read(path)).toMatchObject({ lastLiveRunAt: at(0) });
  });

  it('refuses inside 6 hours, names the time left and --force, and writes nothing', () => {
    expect(MIN_RUN_INTERVAL_MS).toBe(6 * HOUR);
    const path = stamped(HOUR);
    const before = readFileSync(path, 'utf8');
    let error: unknown;
    try {
      startLiveRun(path, NOW, false);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RunTooSoonError);
    expect((error as Error).message).toContain('5h 0m');
    expect((error as Error).message).toContain('--force');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('refuses one millisecond before 6 hours and allows exactly 6 hours', () => {
    expect(() =>
      startLiveRun(stamped(MIN_RUN_INTERVAL_MS - 1), NOW, false),
    ).toThrow(RunTooSoonError);
    const path = stamped(MIN_RUN_INTERVAL_MS);
    startLiveRun(path, NOW, false);
    expect(read(path).lastLiveRunAt).toBe(at(0));
  });

  it('lets --force through, records the start and keeps the details', () => {
    const path = stamped(60_000);
    startLiveRun(path, NOW, true);
    expect(read(path).lastLiveRunAt).toBe(at(0));
    expect(Object.keys(read(path).details)).toEqual(['1']);
  });

  it('refuses a last run dated in the future', () => {
    expect(() => startLiveRun(stamped(-DAY), NOW, false)).toThrow(
      RunTooSoonError,
    );
  });

  it('starts from a corrupt file and reports the reset', () => {
    const path = tempFile();
    writeFileSync(path, 'nope');
    expect(startLiveRun(path, NOW, false).reset).toBe(true);
    expect(read(path)).toMatchObject({ version: 1, lastLiveRunAt: at(0) });
  });

  it('counts a run that stops at a 403 on its first search page', async () => {
    const path = tempFile();
    const { memory } = startLiveRun(path, NOW, false);
    const result = await runCollection(
      boneoAdapter,
      [{ id: 'p', municipality: 'Göteborg', propertyTypes: ['apartment'] }],
      {
        fetch: (async (url: string) =>
          url.endsWith('/robots.txt')
            ? new Response('User-agent: *\nAllow: /\n')
            : new Response('', { status: 403 })) as unknown as typeof fetch,
        now: () => NOW,
        random: () => 0,
        sleep: async () => undefined,
        log: () => undefined,
      },
      () => [],
      memory,
    );
    expect(result.stopped).toBe('http-403');
    expect(read(path).lastLiveRunAt).toBe(at(0));
    expect(() => startLiveRun(path, NOW + HOUR, false)).toThrow(
      RunTooSoonError,
    );
  });
});
