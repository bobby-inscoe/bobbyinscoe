import { createHash, createHmac } from 'node:crypto';
import {
  INGEST_PATH,
  type SenderConfig,
  senderConfig,
  sendRequests,
} from '@house-scanner-tools/sender';
import { sourceRegistry } from '@house-scanner-tools/source-registry';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTRACT_VERSION,
  type IngestRequest,
  ingestRequestSchema,
} from '@/features/house-scanner/types/contracts';

const database = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => database }));

const runId = '00000000-0000-4000-8000-000000000101';
const householdId = '00000000-0000-4000-8000-000000000001';
const secret = 'synthetic-sender-secret-never-a-real-one-0123456789';
const url = `https://project.example.invalid${INGEST_PATH}`;
const config: SenderConfig = { url, keyId: 'sender-key', secret };
const NOW = new Date('2026-10-12T12:00:00Z');
const handlerPath = '../../supabase/functions/house-scanner-ingest/index';
let handler: (request: Request) => Promise<Response>;
const env = new Map<string, string>();
const usedNonces = new Set<string>();
const requests: IngestRequest[] = [
  ingestRequestSchema.parse({
    contractVersion: CONTRACT_VERSION,
    action: 'begin',
    runId,
    sourceIds: ['synthetic-demo'],
    profileVersions: [
      { profileId: '00000000-0000-4000-8000-000000000005', revision: 1 },
    ],
  }),
  ingestRequestSchema.parse({
    contractVersion: CONTRACT_VERSION,
    action: 'stage',
    runId,
    batchId: '00000000-0000-4000-8000-000000000102',
    sourceId: 'synthetic-demo',
    observations: [],
  }),
  ingestRequestSchema.parse({
    contractVersion: CONTRACT_VERSION,
    action: 'publish',
    runId,
    results: [
      {
        sourceId: 'synthetic-demo',
        status: 'partial',
        cursor: null,
        coverageNote: 'Synthetic test run.',
      },
    ],
  }),
];

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  env.clear();
  usedNonces.clear();
  env.set('HS_INGEST_KEYS_JSON', JSON.stringify({ 'sender-key': secret }));
  env.set('SUPABASE_URL', 'https://database.example.invalid');
  env.set('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role-test-only');
  vi.stubGlobal('Deno', {
    serve: (callback: typeof handler) => {
      handler = callback;
    },
    env: { get: (key: string) => env.get(key) },
  });
  database.rpc.mockReset();
  database.rpc.mockImplementation(
    async (name: string, args: Record<string, string>) => {
      if (name === 'hs_ingest_credential')
        return {
          data: {
            householdId,
            sourceIds: ['synthetic-demo'],
            scopes: ['ingest'],
          },
          error: null,
        };
      if (name === 'hs_consume_nonce') {
        if (usedNonces.has(args.p_nonce))
          return { data: null, error: { message: 'replayed' } };
        usedNonces.add(args.p_nonce);
        return { data: null, error: null };
      }
      if (name === 'hs_ingest_policies')
        return { data: [sourceRegistry()[0].policy], error: null };
      if (name === 'hs_ingest')
        return { data: { runId, state: 'staging' }, error: null };
      throw new Error(`Unexpected RPC ${name}`);
    },
  );
  await import(/* @vite-ignore */ handlerPath);
});

type Bytes = Uint8Array<ArrayBuffer>;
type Tamper = (request: Request, body: Bytes) => Request;
// Hands what the sender produced to the real function handler, optionally
// altered on the way, the way a hostile network path would.
function viaHandler(tamper: Tamper = (request) => request) {
  const seen: { headers: Record<string, string>; body: Bytes }[] = [];
  const fetchImpl = vi.fn(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const body = init?.body as Bytes;
      seen.push({ headers: init?.headers as Record<string, string>, body });
      const request = new Request(String(input), {
        method: init?.method,
        headers: init?.headers,
        body,
      });
      return handler(tamper(request, body));
    },
  );
  return {
    seen,
    fetchImpl,
    deps: {
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => Date.now(),
    },
  };
}
const ingestCalls = () =>
  database.rpc.mock.calls.filter(([name]) => name === 'hs_ingest');

describe('signed sender against the real ingest handler', () => {
  it('sends begin, stage and publish in order and the handler accepts each', async () => {
    const { deps, seen } = viaHandler();
    const report = await sendRequests(requests, config, deps);
    expect(report).toEqual({
      total: 3,
      statuses: [
        { action: 'begin', status: 200 },
        { action: 'stage', status: 200 },
        { action: 'publish', status: 200 },
      ],
      stopped: null,
    });
    expect(ingestCalls().map(([, args]) => args.p_request.action)).toEqual([
      'begin',
      'stage',
      'publish',
    ]);
    const body = seen[0].body;
    expect(ingestCalls()[0][1]).toEqual({
      p_key_id: 'sender-key',
      p_body_hash: createHash('sha256').update(body).digest('hex'),
      p_request: JSON.parse(new TextDecoder().decode(body)),
    });
  });

  it('signs the canonical string with a fresh nonce for each request', async () => {
    const { deps, seen } = viaHandler();
    await sendRequests(requests, config, deps);
    const nonces = new Set<string>();
    for (const { headers, body } of seen) {
      expect(headers['x-hs-key-id']).toBe('sender-key');
      expect(headers['x-hs-timestamp']).toMatch(/^\d{10}$/);
      expect(headers['x-hs-nonce']).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
      nonces.add(headers['x-hs-nonce']);
      const digest = createHash('sha256').update(body).digest('hex');
      const expected = createHmac('sha256', secret)
        .update(
          `POST\n/functions/v1/house-scanner-ingest\n${headers['x-hs-timestamp']}\n${headers['x-hs-nonce']}\n${digest}`,
        )
        .digest('hex');
      expect(headers['x-hs-signature']).toBe(expected);
    }
    expect(nonces.size).toBe(3);
  });

  it.each<[string, Tamper]>([
    [
      'body',
      (request, body) =>
        new Request(request.url, {
          method: 'POST',
          headers: request.headers,
          body: new Uint8Array([...body, 32]),
        }),
    ],
    [
      'nonce',
      (request, body) => {
        const headers = new Headers(request.headers);
        headers.set('x-hs-nonce', 'tampered_nonce_0123456789');
        return new Request(request.url, { method: 'POST', headers, body });
      },
    ],
  ])(
    'rejects a tampered %s before any database write',
    async (_label, tamper) => {
      const { deps } = viaHandler(tamper);
      const report = await sendRequests(requests, config, deps);
      expect(report.statuses).toEqual([]);
      expect(report.stopped).toEqual({ action: 'begin', status: 401 });
      expect(ingestCalls()).toHaveLength(0);
    },
  );

  it('rejects a request that reaches a different path', async () => {
    const { deps } = viaHandler(
      (request, body) =>
        new Request(`${new URL(request.url).origin}/functions/v1/other`, {
          method: 'POST',
          headers: request.headers,
          body,
        }),
    );
    const report = await sendRequests(requests, config, deps);
    expect(report.stopped).toEqual({ action: 'begin', status: 404 });
    expect(ingestCalls()).toHaveLength(0);
  });

  it('is rejected when the secret differs from the stored one', async () => {
    const { deps } = viaHandler();
    const report = await sendRequests(
      requests,
      { ...config, secret: `${secret}-other` },
      deps,
    );
    expect(report.stopped).toEqual({ action: 'begin', status: 401 });
  });
});

describe('sender behavior', () => {
  const fake = (statuses: (number | Error)[], echo = '') => {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = vi.fn(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        const next = statuses[calls.length - 1] ?? 200;
        if (next instanceof Error) throw next;
        return new Response(JSON.stringify({ error: echo }), { status: next });
      },
    );
    return {
      calls,
      deps: { fetch: impl as unknown as typeof fetch, now: () => Date.now() },
    };
  };

  it('stops at the first non-2xx and never retries', async () => {
    const { calls, deps } = fake([200, 409, 200]);
    const report = await sendRequests(requests, config, deps);
    expect(calls).toHaveLength(2);
    expect(report.statuses).toEqual([{ action: 'begin', status: 200 }]);
    expect(report.stopped).toEqual({ action: 'stage', status: 409 });
  });

  it('stops on a network error and reports no status', async () => {
    const { calls, deps } = fake([new TypeError('socket closed')]);
    const report = await sendRequests(requests, config, deps);
    expect(calls).toHaveLength(1);
    expect(report.stopped).toEqual({ action: 'begin', status: null });
  });

  it('never exposes the secret in the report or errors, even when echoed back', async () => {
    for (const statuses of [
      [500],
      [new Error(`failed with ${secret}`)],
      [200],
    ]) {
      const { deps } = fake(statuses, secret);
      const report = await sendRequests(requests, config, deps);
      expect(JSON.stringify(report)).not.toContain(secret);
    }
    const attempts: string[] = [];
    for (const bad of [
      {
        HS_INGEST_URL: url,
        HS_INGEST_KEY_ID: 'k',
        HS_INGEST_SECRET: 'short-secret-value',
      },
      {
        HS_INGEST_URL: `http://${secret}.example.invalid${INGEST_PATH}`,
        HS_INGEST_KEY_ID: 'k',
        HS_INGEST_SECRET: secret,
      },
    ]) {
      try {
        senderConfig(bad);
      } catch (error) {
        attempts.push(String(error));
      }
    }
    expect(attempts).toHaveLength(2);
    for (const text of attempts) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain('short-secret-value');
    }
  });

  it.each<[string, IngestRequest[]]>([
    ['publish first', [requests[2], requests[0]]],
    ['no publish', [requests[0], requests[1]]],
    ['stage before begin', [requests[1], requests[0], requests[2]]],
    ['begin in the middle', [requests[0], requests[0], requests[2]]],
  ])('refuses a wrongly ordered run: %s', async (_label, wrong) => {
    const { calls, deps } = fake([]);
    await expect(sendRequests(wrong, config, deps)).rejects.toThrow(
      'begin, then stage requests, then publish',
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses a stage request over one hundred observations', async () => {
    const { calls, deps } = fake([]);
    const stage = requests[1];
    if (stage.action !== 'stage') throw new Error('fixture');
    const over = {
      ...stage,
      observations: Array.from({ length: 101 }, () => ({})),
    } as unknown as IngestRequest;
    await expect(
      sendRequests([requests[0], over, requests[2]], config, deps),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it('posts JSON without cookies or redirects to the configured URL', async () => {
    const { calls, deps } = fake([]);
    await sendRequests(requests, config, deps);
    for (const { url: target, init } of calls) {
      expect(target).toBe(url);
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('manual');
      expect(init.credentials).toBe('omit');
      expect((init.headers as Record<string, string>)['content-type']).toBe(
        'application/json',
      );
    }
  });
});

describe('sender configuration', () => {
  const good = {
    HS_INGEST_URL: url,
    HS_INGEST_KEY_ID: 'sender-key',
    HS_INGEST_SECRET: secret,
  };

  it('accepts hosted https and a local http stack', () => {
    expect(senderConfig(good)).toEqual({
      url,
      keyId: 'sender-key',
      secret,
    });
    expect(
      senderConfig({
        ...good,
        HS_INGEST_URL: `http://localhost:54321${INGEST_PATH}`,
      }).url,
    ).toBe(`http://localhost:54321${INGEST_PATH}`);
  });

  it.each([
    [
      'plain http for a hosted project',
      { HS_INGEST_URL: `http://project.example.invalid${INGEST_PATH}` },
    ],
    [
      'http for a lookalike host',
      { HS_INGEST_URL: `http://localhost.example.invalid${INGEST_PATH}` },
    ],
    [
      'a different path',
      { HS_INGEST_URL: 'https://project.example.invalid/functions/v1/other' },
    ],
    [
      'credentials in the URL',
      {
        HS_INGEST_URL: `https://user:pw@project.example.invalid${INGEST_PATH}`,
      },
    ],
    ['a query string', { HS_INGEST_URL: `${url}?apikey=x` }],
    ['no URL', { HS_INGEST_URL: undefined }],
    ['a short secret', { HS_INGEST_SECRET: 'x'.repeat(31) }],
    ['no secret', { HS_INGEST_SECRET: undefined }],
    ['no key id', { HS_INGEST_KEY_ID: undefined }],
    ['a malformed key id', { HS_INGEST_KEY_ID: 'bad key!' }],
  ])('refuses %s', (_label, change) => {
    expect(() => senderConfig({ ...good, ...change })).toThrow();
  });
});
