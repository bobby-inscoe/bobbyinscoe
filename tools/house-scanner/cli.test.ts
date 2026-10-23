import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';

beforeAll(() => {
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/vite/bin/vite.js'),
      'build',
      '--config',
      'tools/house-scanner/vite.config.ts',
    ],
    { stdio: 'pipe' },
  );
});

const collector = (
  args: string[],
  options: Parameters<typeof spawnSync>[2] = {},
) =>
  spawnSync(process.execPath, ['.house-scanner-build/collector.mjs', ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    ...options,
  });

it('reports actual observation and request counts without logging source payloads', () => {
  const result = collector([]);
  expect(result.status).toBe(0);
  expect(JSON.parse(String(result.stdout))).toMatchObject({
    mode: 'fixture-dry',
    liveCoverage: false,
    observationCount: 3,
    requestCount: 3,
  });
  expect(result.stdout).not.toContain('https://');
  expect(result.stdout).not.toContain('Fictional demo home');
});

// Every case below must be refused before the collector makes any request.
const SECRET = 'synthetic-cli-secret-not-real-0123456789abcdef';
const LIVE = ['--live', '--source=boneo', '--confirm-personal-read'];

it.each([
  [['--mode', 'live']],
  [['--live']],
  [['--live', '--source=boneo']],
  [['--source=boneo', '--confirm-personal-read']],
  [[...LIVE, '--send']],
  [['--send', '--confirm-send']],
])('refuses %j without every live or send flag', (args) => {
  const result = collector(args);
  expect(result.status).toBe(1);
  expect(JSON.parse(String(result.stderr))).toMatchObject({
    status: 'rejected',
  });
  expect(result.stdout).toBe('');
  expect(result.stderr).not.toContain('https://');
});

it.each([
  [
    {
      HS_INGEST_URL:
        'http://project.example.invalid/functions/v1/house-scanner-ingest',
    },
  ],
  [{ HS_INGEST_SECRET: 'too-short' }],
])(
  'refuses to send with an unusable ingest environment %j before reading',
  (change) => {
    const result = collector([...LIVE, '--send', '--confirm-send'], {
      env: {
        ...process.env,
        HS_INGEST_URL:
          'https://project.example.invalid/functions/v1/house-scanner-ingest',
        HS_INGEST_KEY_ID: 'cli-key',
        HS_INGEST_SECRET: SECRET,
        ...change,
      },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain(SECRET);
    expect(JSON.parse(String(result.stderr))).toMatchObject({
      status: 'rejected',
    });
  },
);

// These runs block fetch in the child process, so a missing guard fails a test
// instead of reaching the source.
const noFetch = join(
  mkdtempSync(join(tmpdir(), 'hs-nofetch-')),
  'no-fetch.cjs',
);
writeFileSync(
  noFetch,
  "globalThis.fetch = async () => { throw new TypeError('blocked in test'); };",
);
const runLive = (cwd: string, ...args: string[]) =>
  spawnSync(
    process.execPath,
    [
      '--require',
      noFetch,
      resolve('.house-scanner-build/collector.mjs'),
      ...args,
    ],
    { encoding: 'utf8', timeout: 20_000, cwd },
  );
const tempDir = () => mkdtempSync(join(tmpdir(), 'hs-cwd-'));

it('reads live only with an executor, asks robots.txt first, and ignores an old --profiles argument', () => {
  const result = runLive(
    tempDir(),
    '--live',
    '--source=bjurfors',
    '--confirm-personal-read',
    '--profiles',
    join(tmpdir(), 'hs-missing-profiles.json'),
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    stopped: 'robots-unavailable',
    requestCount: 1,
  });
  const refused = runLive(
    tempDir(),
    '--live',
    '--source=alvhem',
    '--confirm-personal-read',
  );
  expect(refused.status).toBe(1);
  expect(refused.stdout).toBe('');
});

it('never creates the run memory file in fixture mode and rejects its flags there', () => {
  const cwd = tempDir();
  const run = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [resolve('.house-scanner-build/collector.mjs'), ...args],
      { encoding: 'utf8', cwd },
    );
  expect(run().status).toBe(0);
  expect(run('--cache', join(cwd, 'c.json')).status).toBe(1);
  expect(run('--force').status).toBe(1);
  expect(readdirSync(cwd)).toEqual([]);
});

it('refuses a live read within 6 hours of the last one before any request, and --force bypasses it', () => {
  const cwd = tempDir();
  const cache = join(cwd, 'memory.json');

  const first = runLive(cwd, ...LIVE, '--cache', cache);
  expect(first.status).toBe(0);
  const written = JSON.parse(readFileSync(cache, 'utf8'));
  expect(Math.abs(Date.parse(written.lastLiveRunAt) - Date.now())).toBeLessThan(
    60_000,
  );

  const second = runLive(cwd, ...LIVE, '--cache', cache);
  expect(second.status).toBe(1);
  expect(second.stdout).toBe('');
  const rejected = JSON.parse(second.stderr);
  expect(rejected).toMatchObject({
    status: 'rejected',
    category: 'run-interval',
  });
  expect(rejected.notice).toContain('--force');
  expect(readFileSync(cache, 'utf8')).toBe(JSON.stringify(written));

  const forced = runLive(cwd, ...LIVE, '--cache', cache, '--force');
  expect(forced.status).toBe(0);
  expect(JSON.parse(forced.stdout)).toMatchObject({ requestCount: 1 });
});

it('reports an unreadable run memory file and carries on', () => {
  const cwd = tempDir();
  const cache = join(cwd, 'memory.json');
  writeFileSync(cache, 'not json');
  const result = runLive(cwd, ...LIVE, '--cache', cache);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ cacheReset: true });
  expect(readFileSync(cache, 'utf8')).toContain('"lastLiveRunAt"');
});
