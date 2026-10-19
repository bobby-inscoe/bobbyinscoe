import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { criteriaSchema } from '@/features/house-scanner/types/contracts';
import {
  ADMIN_PROBES,
  type CheckResult,
  PUBLIC_RPC_PROBES,
  SERVICE_RPC_PROBES,
} from './checks';
import { parseArgs, parseEnv } from './config';
import { createFakeGateway, type Flaws } from './fake-backend';
import type { Gateway } from './gateway';
import { type Io, runAcceptance } from './run';
import { FICTIONAL_CRITERIA, seedSql } from './seed-sql';

const KEY = 'sb_publishable_FakeFakeFakeFakeFakeFake1234';
const SECRETS = {
  url: 'https://fakeprojectref.supabase.co',
  key: KEY,
  aEmail: 'owner.a@example.test',
  aPassword: 'pw-a-FAKE-1',
  a2Email: 'member.a2@example.test',
  a2Password: 'pw-a2-FAKE-2',
  bEmail: 'owner.b@example.test',
  bPassword: 'pw-b-FAKE-3',
};
const BASE_ENV = {
  HS_ACCEPT_URL: SECRETS.url,
  HS_ACCEPT_PUBLISHABLE_KEY: SECRETS.key,
  HS_ACCEPT_A_EMAIL: SECRETS.aEmail,
  HS_ACCEPT_A_PASSWORD: SECRETS.aPassword,
  HS_ACCEPT_B_EMAIL: SECRETS.bEmail,
  HS_ACCEPT_B_PASSWORD: SECRETS.bPassword,
};
const A2_ENV = {
  ...BASE_ENV,
  HS_ACCEPT_A2_EMAIL: SECRETS.a2Email,
  HS_ACCEPT_A2_PASSWORD: SECRETS.a2Password,
};

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const files = new Map<string, string>();
  const io: Io = {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    writeFile: (path, text) => files.set(path, text),
  };
  return { io, out, err, files };
}

async function run(
  argv: string[],
  env: Record<string, string | undefined>,
  gateway: Gateway = createFakeGateway(),
) {
  const c = capture();
  const code = await runAcceptance(argv, env, c.io, () => gateway);
  const report = c.files.get('report.json');
  return {
    code,
    stdout: c.out.join('\n'),
    stderr: c.err.join('\n'),
    report: report
      ? (JSON.parse(report) as { ok: boolean; results: CheckResult[] })
      : null,
  };
}

async function statuses(
  flaws: Flaws,
  extra: {
    argv?: string[];
    env?: Record<string, string>;
    a2Deactivated?: boolean;
  } = {},
) {
  const argv = [
    '--confirm-hosted',
    '--out',
    'report.json',
    ...(extra.argv ?? []),
  ];
  const result = await run(
    argv,
    extra.env ?? BASE_ENV,
    createFakeGateway(flaws, { a2Deactivated: extra.a2Deactivated }),
  );
  const byId = Object.fromEntries(
    (result.report?.results ?? []).map((r) => [r.id, r.status]),
  );
  return { ...result, byId };
}

describe('against a well-behaved backend', () => {
  it('passes every check it can run and exits 0', async () => {
    const result = await statuses({});
    expect(result.code).toBe(0);
    expect(result.byId).toEqual({
      '0-setup': 'PASS',
      '1-anon-denied': 'PASS',
      '2-user-a-snapshot': 'PASS',
      '3-cross-household': 'PASS',
      '4-round-trip': 'PASS',
      '4b-stale-error-shape': 'PASS',
      '5-concurrent-save': 'PASS',
      '6-privileged-denied': 'PASS',
      '7-deactivated-member': 'SKIPPED',
      '8-cleanup': 'PASS',
    });
    expect(result.stdout).toContain('PASS');
    expect(result.stdout).toContain('7-deactivated-member');
  });

  it('leaves no favorite and an empty note body', async () => {
    const gateway = createFakeGateway();
    await run(['--confirm-hosted'], BASE_ENV, gateway);
    const a = await gateway.signIn('A');
    if (!a.ok) throw new Error('fake sign-in failed');
    const memberships = (await a.caller.rpc('hs_memberships', {})).data as {
      householdId: string;
    }[];
    const snapshot = (
      await a.caller.rpc('hs_snapshot', {
        p_household_id: memberships[0].householdId,
      })
    ).data as { favorites: unknown[]; listings: { id: string }[] };
    expect(snapshot.favorites).toEqual([]);
    const notes = (
      await a.caller.rpc('hs_notes', {
        p_household_id: memberships[0].householdId,
        p_listing_id: snapshot.listings[0].id,
      })
    ).data as { body: string }[];
    expect(notes.map((n) => n.body)).toEqual(['']);
  });

  it('records the real error shape of a stale save', async () => {
    const { report } = await statuses({});
    const stale = report?.results.find((r) => r.id === '4b-stale-error-shape');
    expect(stale?.observations.join('\n')).toMatch(/status 409, code 40001/);
  });
});

describe('against a backend that breaks one guarantee', () => {
  it('fails the cross-household check when a snapshot leaks', async () => {
    const result = await statuses({ leakSnapshotToOutsiders: true });
    expect(result.byId['3-cross-household']).toBe('FAIL');
    expect(result.code).toBe(1);
  });

  it('fails the anon check when anon can run household functions', async () => {
    const result = await statuses({ anonAllowed: true });
    expect(result.byId['1-anon-denied']).toBe('FAIL');
    expect(result.code).toBe(1);
  });

  it('fails when an authenticated user can run the purge', async () => {
    const result = await statuses({ purgeAllowed: true });
    expect(result.byId['6-privileged-denied']).toBe('FAIL');
  });

  it('fails when the hs schema is exposed', async () => {
    const result = await statuses({ hsSchemaExposed: true });
    expect(result.byId['1-anon-denied']).toBe('FAIL');
    expect(result.byId['6-privileged-denied']).toBe('FAIL');
  });

  it('fails when a stale save has a different code than the app expects', async () => {
    const result = await statuses({ staleCode: '23505' });
    expect(result.byId['4b-stale-error-shape']).toBe('FAIL');
    expect(result.byId['5-concurrent-save']).toBe('FAIL');
  });

  it('fails when concurrent saves both win', async () => {
    const result = await statuses({ noRevisionCheck: true });
    expect(result.byId['5-concurrent-save']).toBe('FAIL');
  });

  it('skips the dependent checks when sign-in fails, and still runs the anon check', async () => {
    const result = await statuses({ signInFails: true });
    expect(result.byId['0-setup']).toBe('FAIL');
    expect(result.byId['1-anon-denied']).toBe('PASS');
    expect(result.byId['3-cross-household']).toBe('SKIPPED');
    expect(result.code).toBe(1);
  });
});

describe('deactivated second member', () => {
  it('is skipped without the flag even when A2 is provided', async () => {
    const result = await statuses({}, { env: A2_ENV });
    expect(result.byId['7-deactivated-member']).toBe('SKIPPED');
  });

  it('passes when A2 is locked out', async () => {
    const result = await statuses(
      {},
      { env: A2_ENV, argv: ['--a2-deactivated'], a2Deactivated: true },
    );
    expect(result.byId['7-deactivated-member']).toBe('PASS');
  });

  it('fails when a deactivated A2 can still read', async () => {
    const result = await statuses(
      { a2StillActive: true },
      { env: A2_ENV, argv: ['--a2-deactivated'], a2Deactivated: true },
    );
    expect(result.byId['7-deactivated-member']).toBe('FAIL');
  });
});

describe('refusals', () => {
  it('refuses without --confirm-hosted and never touches the backend', async () => {
    const gateway = createFakeGateway();
    const result = await run([], BASE_ENV, gateway);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--confirm-hosted');
    expect(gateway.log).toEqual([]);
  });

  it('refuses a host that is not supabase.co or localhost', async () => {
    for (const url of [
      'https://example.com',
      'https://supabase.co.evil.test',
      'https://fakeprojectref.supabase.co.evil.test',
    ]) {
      const gateway = createFakeGateway();
      const result = await run(
        ['--confirm-hosted'],
        { ...BASE_ENV, HS_ACCEPT_URL: url },
        gateway,
      );
      expect(result.code).toBe(2);
      expect(gateway.log).toEqual([]);
      expect(result.stderr).not.toContain(url);
    }
  });

  it('refuses plain http for a hosted project and a URL with credentials', () => {
    expect(
      parseEnv({ ...BASE_ENV, HS_ACCEPT_URL: 'http://x.supabase.co' }).ok,
    ).toBe(false);
    expect(
      parseEnv({ ...BASE_ENV, HS_ACCEPT_URL: 'https://u:p@x.supabase.co' }).ok,
    ).toBe(false);
  });

  it('accepts a local stack', () => {
    expect(
      parseEnv({ ...BASE_ENV, HS_ACCEPT_URL: 'http://127.0.0.1:54321' }).ok,
    ).toBe(true);
  });

  it('refuses a secret or legacy key without echoing it', async () => {
    // Assembled at runtime so no literal in the repository looks like a real
    // key to secret scanners. It is not a credential.
    const secretKey = ['sb', 'secret', 'NotARealKeyJustATestFixture'].join('_');
    const result = await run(['--confirm-hosted'], {
      ...BASE_ENV,
      HS_ACCEPT_PUBLISHABLE_KEY: secretKey,
    });
    expect(result.code).toBe(2);
    expect(result.stderr).not.toContain(secretKey);
  });

  it('names a missing variable, never a value', () => {
    const { HS_ACCEPT_B_PASSWORD: _omitted, ...env } = BASE_ENV;
    const parsed = parseEnv(env);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('HS_ACCEPT_B_PASSWORD');
  });

  it('rejects unknown arguments and secrets passed as arguments', () => {
    expect(parseArgs(['--password', 'x']).ok).toBe(false);
    expect(parseArgs(['--out']).ok).toBe(false);
    expect(parseArgs(['--confirm-hosted', '--out', 'r.json'])).toEqual({
      ok: true,
      value: {
        confirmHosted: true,
        printSeedSql: false,
        a2Deactivated: false,
        out: 'r.json',
      },
    });
  });
});

describe('secrets', () => {
  it('never appear in stdout, stderr or the JSON report, even when the server echoes them', async () => {
    const echo = Object.values(SECRETS).join(' ');
    const inner = createFakeGateway();
    const echoing: Gateway = {
      anon: () => ({
        ...inner.anon(),
        rpc: async (name) => ({
          status: 401,
          data: null,
          error: {
            code: '42501',
            message: `permission denied ${name} ${echo}`,
          },
        }),
      }),
      signIn: (label) => inner.signIn(label),
    };
    const result = await run(
      ['--confirm-hosted', '--out', 'report.json'],
      A2_ENV,
      echoing,
    );
    const everything = `${result.stdout}\n${result.stderr}\n${JSON.stringify(result.report)}`;
    for (const value of Object.values(SECRETS))
      expect(everything).not.toContain(value);
    expect(everything).toContain('[redacted]');
  });

  it('keeps ids and emails out of the JSON report', async () => {
    const { report } = await statuses({}, { env: A2_ENV });
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
    expect(text).not.toContain('@');
  });
});

describe('seed SQL', () => {
  it('prints without any environment and is marked fictional', async () => {
    const result = await run(['--print-seed-sql'], {});
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('FICTIONAL TEST DATA');
    expect(result.stdout).toContain('hs.admin_bootstrap_household');
    expect(result.stdout).toContain('hs.admin_set_member');
    expect(result.stdout).toContain('<USER A UUID>');
  });

  it('uses criteria that satisfy the app contract', () => {
    expect(criteriaSchema.safeParse(FICTIONAL_CRITERIA).success).toBe(true);
    expect(Object.keys(FICTIONAL_CRITERIA)).toHaveLength(14);
    expect(seedSql()).toContain(JSON.stringify(FICTIONAL_CRITERIA));
  });
});

describe('probe arguments match the migrations', () => {
  const sql = readdirSync(resolve('supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(resolve('supabase/migrations', name), 'utf8'))
    .join('\n');

  function parameters(schema: string, name: string) {
    const match = new RegExp(
      `create function ${schema}\\.${name}\\(([^)]*)\\)`,
    ).exec(sql);
    if (!match) throw new Error(`${schema}.${name} not found`);
    return match[1]
      .split(',')
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean)
      .sort();
  }

  it.each([
    ['public', PUBLIC_RPC_PROBES],
    ['public', SERVICE_RPC_PROBES],
    ['hs', ADMIN_PROBES],
  ] as const)('%s functions', (schema, probes) => {
    for (const [name, args] of Object.entries(probes)) {
      const declared = parameters(schema, name);
      const given = Object.keys(args).sort();
      // Defaults may be omitted, so the probe must cover every declared name it uses.
      expect(declared).toEqual(expect.arrayContaining(given));
      expect(given.length).toBeGreaterThanOrEqual(
        declared.length - (name === 'admin_set_member' ? 2 : 0),
      );
    }
  });
});
