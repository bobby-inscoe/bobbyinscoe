import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';

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

it('reports actual observation and request counts without logging source payloads', () => {
  const result = spawnSync(
    process.execPath,
    ['.house-scanner-build/collector.mjs'],
    { encoding: 'utf8' },
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    mode: 'fixture-dry',
    liveCoverage: false,
    observationCount: 3,
    requestCount: 3,
  });
  expect(result.stdout).not.toContain('https://');
  expect(result.stdout).not.toContain('Fictional demo home');
});

it.each([
  ['--mode', 'live'],
  ['--source', 'bjurfors'],
])('rejects unsupported execution options %j with safe output', (...args) => {
  const result = spawnSync(
    process.execPath,
    ['.house-scanner-build/collector.mjs', ...args],
    { encoding: 'utf8' },
  );
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({
    status: 'rejected',
    category: 'permission-or-configuration',
  });
  expect(result.stdout).toBe('');
  expect(result.stderr).not.toContain('https://');
});

it.each([
  [['--live']],
  [['--live', '--source=boneo']],
  [['--live', '--confirm-personal-read']],
  [
    [
      '--live',
      '--source=boneo',
      '--confirm-personal-read',
      '--at=2026-10-13T00:00:00Z',
    ],
  ],
  [['--live', '--source=bjurfors', '--confirm-personal-read']],
  [['--source=boneo', '--confirm-personal-read']],
  [['--source=boneo']],
])('refuses live reading without every flag: %j', (args) => {
  const result = spawnSync(
    process.execPath,
    ['.house-scanner-build/collector.mjs', ...args],
    { encoding: 'utf8', timeout: 10_000 },
  );
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stderr)).toMatchObject({
    status: 'rejected',
    category: 'permission-or-configuration',
  });
  expect(result.stdout).toBe('');
});

// Every case below must be refused before the collector makes any request.
const SECRET = 'synthetic-cli-secret-not-real-0123456789abcdef';
const profilesPath = join(
  mkdtempSync(join(tmpdir(), 'hs-profiles-')),
  'profiles.json',
);
writeFileSync(
  profilesPath,
  JSON.stringify(
    SYNTHETIC_SNAPSHOT.profiles.map(({ id, revision, enabled, criteria }) => ({
      id,
      revision,
      enabled,
      criteria,
    })),
  ),
);
const LIVE = ['--live', '--source=boneo', '--confirm-personal-read'];

it.each([
  [[...LIVE]],
  [[...LIVE, '--send', '--profiles', profilesPath]],
  [[...LIVE, '--confirm-send', '--profiles', profilesPath]],
  [['--send', '--confirm-send']],
  [['--send', '--confirm-send', '--profiles', profilesPath]],
  [[...LIVE, '--profiles', join(tmpdir(), 'hs-missing-profiles.json')]],
])(
  'refuses live runs without a profiles file or with incomplete send flags: %j',
  (args) => {
    const result = spawnSync(
      process.execPath,
      ['.house-scanner-build/collector.mjs', ...args],
      { encoding: 'utf8', timeout: 10_000 },
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ status: 'rejected' });
    expect(result.stdout).toBe('');
  },
);

it.each([
  [
    {
      HS_INGEST_URL:
        'http://project.example.invalid/functions/v1/house-scanner-ingest',
    },
  ],
  [
    {
      HS_INGEST_URL:
        'https://project.example.invalid/functions/v1/house-scanner-ingest',
      HS_INGEST_SECRET: 'too-short',
    },
  ],
  [{ HS_INGEST_URL: undefined }],
])(
  'refuses to send with an unusable ingest environment %j before reading',
  (change) => {
    const result = spawnSync(
      process.execPath,
      [
        '.house-scanner-build/collector.mjs',
        ...LIVE,
        '--send',
        '--confirm-send',
        '--profiles',
        profilesPath,
      ],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          ...{
            HS_INGEST_URL:
              'https://project.example.invalid/functions/v1/house-scanner-ingest',
            HS_INGEST_KEY_ID: 'cli-key',
            HS_INGEST_SECRET: SECRET,
          },
          ...change,
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain(SECRET);
    expect(JSON.parse(result.stderr)).toMatchObject({ status: 'rejected' });
  },
);

const HOUSEHOLD = '00000000-0000-4000-8000-0000000000aa';
const runPrinter = (...args: string[]) =>
  spawnSync(
    process.execPath,
    ['.house-scanner-build/collector.mjs', '--print-policy-sql', ...args],
    { encoding: 'utf8' },
  );

it('prints the SQL that approves the Boneo policy without any network or file access', () => {
  const result = runPrinter('--source=boneo', `--household=${HOUSEHOLD}`);
  expect(result.status).toBe(0);
  const match =
    /^select hs\.admin_set_source_policy\('([^']+)', '(.*)'::jsonb\);\n$/s.exec(
      result.stdout,
    );
  expect(match?.[1]).toBe(HOUSEHOLD);
  const policy = JSON.parse((match?.[2] ?? '').replaceAll("''", "'"));
  expect(policy).toMatchObject({
    sourceId: 'boneo',
    status: 'approved',
    automatedCollection: true,
    privateDisplay: true,
    imageDisplay: true,
    imageHotlink: true,
    imageOrigins: ['https://files.boneo.se'],
  });
  expect(Date.parse(policy.reviewedAt)).toBeLessThan(Date.now());
  expect(Date.parse(policy.reviewDueAt)).toBeGreaterThan(Date.now());
});

it('prints the SQL that approves the Bjurfors policy at revision 2', () => {
  const result = runPrinter('--source=bjurfors', `--household=${HOUSEHOLD}`);
  expect(result.status).toBe(0);
  const match =
    /^select hs\.admin_set_source_policy\('([^']+)', '(.*)'::jsonb\);\n$/s.exec(
      result.stdout,
    );
  expect(match?.[1]).toBe(HOUSEHOLD);
  const policy = JSON.parse((match?.[2] ?? '').replaceAll("''", "'"));
  expect(policy).toMatchObject({
    sourceId: 'bjurfors',
    revision: 2,
    status: 'approved',
    automatedCollection: true,
    privateDisplay: true,
    imageDisplay: true,
    imageHotlink: true,
    imageOrigins: ['https://www.bjurfors.se'],
    listingOrigins: ['https://www.bjurfors.se'],
    retentionDays: 14,
  });
  expect(policy.allowedFactFields).toContain('groundFloor');
});

it.each([
  [['--source=boneo']],
  [['--source=boneo', '--household=not-a-uuid']],
  [['--source=bjurfors']],
  [['--source=bjurfors', '--household=not-a-uuid']],
  [['--source=alvhem', `--household=${HOUSEHOLD}`]],
])('refuses to print policy SQL for %j', (args) => {
  const result = runPrinter(...args);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
});

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
      ...LIVE,
      '--profiles',
      profilesPath,
      ...args,
    ],
    { encoding: 'utf8', timeout: 20_000, cwd },
  );

it('reads bjurfors live under the same flags, and makes its first request to robots.txt only', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hs-cwd-'));
  const result = spawnSync(
    process.execPath,
    [
      '--require',
      noFetch,
      resolve('.house-scanner-build/collector.mjs'),
      '--live',
      '--source=bjurfors',
      '--confirm-personal-read',
      '--profiles',
      profilesPath,
    ],
    { encoding: 'utf8', timeout: 20_000, cwd },
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    stopped: 'robots-unavailable',
    requestCount: 1,
  });
});

it('refuses a live read of a source that has no executor', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--require',
      noFetch,
      resolve('.house-scanner-build/collector.mjs'),
      '--live',
      '--source=alvhem',
      '--confirm-personal-read',
      '--profiles',
      profilesPath,
    ],
    {
      encoding: 'utf8',
      timeout: 20_000,
      cwd: mkdtempSync(join(tmpdir(), 'hs-cwd-')),
    },
  );
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
});

it('never creates the run memory file in fixture mode and rejects its flags there', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hs-cwd-'));
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
  const cwd = mkdtempSync(join(tmpdir(), 'hs-cwd-'));
  const cache = join(cwd, 'memory.json');

  const first = runLive(cwd, '--cache', cache);
  expect(first.status).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({
    stopped: 'robots-unavailable',
    requestCount: 1,
    detailCached: 0,
  });
  const written = JSON.parse(readFileSync(cache, 'utf8'));
  expect(Math.abs(Date.parse(written.lastLiveRunAt) - Date.now())).toBeLessThan(
    60_000,
  );

  const second = runLive(cwd, '--cache', cache);
  expect(second.status).toBe(1);
  expect(second.stdout).toBe('');
  const rejected = JSON.parse(second.stderr);
  expect(rejected).toMatchObject({
    status: 'rejected',
    category: 'run-interval',
  });
  expect(rejected.notice).toMatch(/5h \d+m|6h 0m/);
  expect(rejected.notice).toContain('--force');
  expect(readFileSync(cache, 'utf8')).toBe(JSON.stringify(written));

  const forced = runLive(cwd, '--cache', cache, '--force');
  expect(forced.status).toBe(0);
  expect(JSON.parse(forced.stdout)).toMatchObject({ requestCount: 1 });
});

it('reports an unreadable run memory file and carries on', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hs-cwd-'));
  const cache = join(cwd, 'memory.json');
  writeFileSync(cache, 'not json');
  const result = runLive(cwd, '--cache', cache);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ cacheReset: true });
  expect(readFileSync(cache, 'utf8')).toContain('"lastLiveRunAt"');
});
