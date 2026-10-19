import { createHash, createHmac } from 'node:crypto';
import { sourceRegistry } from '@house-scanner-tools/source-registry';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sourcePolicySchema } from '@/features/house-scanner/types/contracts';

const database = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => database }));
const runId = '00000000-0000-4000-8000-000000000101';
const householdId = '00000000-0000-4000-8000-000000000001';
const secret = 'synthetic-test-key-only-never-a-real-secret';
const path = '/functions/v1/house-scanner-ingest';
let handler: (request: Request) => Promise<Response>;
const env = new Map<string, string>();
const usedNonces = new Set<string>();
const body = JSON.stringify({
  contractVersion: 1,
  action: 'begin',
  runId,
  sourceIds: ['synthetic-demo'],
  profileVersions: [
    { profileId: '00000000-0000-4000-8000-000000000005', revision: 1 },
  ],
});

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
  env.clear();
  usedNonces.clear();
  env.set('HS_INGEST_KEYS_JSON', JSON.stringify({ 'test-key': secret }));
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
          return {
            data: null,
            error: { message: 'private database diagnostics' },
          };
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
  await import('./index');
});

function signedRequest(
  options: {
    payload?: string;
    actualBody?: string;
    timestamp?: string;
    nonce?: string;
    signaturePath?: string;
    requestPath?: string;
    headers?: HeadersInit;
  } = {},
) {
  const payload = options.payload ?? body;
  const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
  const nonce = options.nonce ?? 'synthetic_nonce_1234';
  const digest = createHash('sha256').update(payload).digest('hex');
  const signature = createHmac('sha256', secret)
    .update(
      `POST\n${options.signaturePath ?? path}\n${timestamp}\n${nonce}\n${digest}`,
    )
    .digest('hex');
  return new Request(
    `https://local.example.invalid${options.requestPath ?? path}`,
    {
      method: 'POST',
      body: options.actualBody ?? payload,
      headers: {
        'content-type': 'application/json',
        'x-hs-key-id': 'test-key',
        'x-hs-timestamp': timestamp,
        'x-hs-nonce': nonce,
        'x-hs-signature': signature,
        ...options.headers,
      },
    },
  );
}

describe('signed ingestion trust boundary', () => {
  it('accepts valid raw bytes and binds the database request to the key and digest', async () => {
    const response = await handler(signedRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(database.rpc).toHaveBeenLastCalledWith('hs_ingest', {
      p_key_id: 'test-key',
      p_body_hash: createHash('sha256').update(body).digest('hex'),
      p_request: JSON.parse(body),
    });
    expect(await response.json()).toEqual({ runId, state: 'staging' });
  });
  it('accepts the gateway stripped path while retaining the canonical signing path', async () => {
    expect(
      (await handler(signedRequest({ requestPath: '/house-scanner-ingest' })))
        .status,
    ).toBe(200);
  });
  it.each<Parameters<typeof signedRequest>[0]>([
    { actualBody: `${body} ` },
    { signaturePath: '/house-scanner-ingest' },
    { headers: { 'x-hs-nonce': 'different_nonce_1234' } },
    { headers: { 'x-hs-signature': '0'.repeat(64) } },
    { headers: { 'x-hs-key-id': 'unknown-key' } },
    { timestamp: '1791805799' },
  ])(
    'rejects tampering or expired credentials before any database access: %j',
    async (options) => {
      const response = await handler(signedRequest(options));
      expect(response.status).toBe(401);
      expect(database.rpc).not.toHaveBeenCalled();
      expect(await response.json()).toEqual({
        error: 'Request not authorized',
      });
    },
  );
  it('rejects replay before publication and does not leak database diagnostics', async () => {
    expect((await handler(signedRequest())).status).toBe(200);
    const replay = await handler(signedRequest());
    expect(replay.status).toBe(409);
    expect(await replay.text()).not.toContain('private database diagnostics');
    expect(
      database.rpc.mock.calls.filter(([name]) => name === 'hs_ingest'),
    ).toHaveLength(1);
  });
  it.each([
    { ...JSON.parse(body), householdId },
    { ...JSON.parse(body), sourceIds: ['unapproved-source'] },
    { ...JSON.parse(body), sourceIds: ['synthetic-demo', 'synthetic-demo'] },
    {
      ...JSON.parse(body),
      profileVersions: [
        ...JSON.parse(body).profileVersions,
        ...JSON.parse(body).profileVersions,
      ],
    },
  ])(
    'rejects caller-owned identity or invalid scope after consuming the nonce: %j',
    async (payload) => {
      expect(
        (await handler(signedRequest({ payload: JSON.stringify(payload) })))
          .status,
      ).toBe(422);
      expect(
        database.rpc.mock.calls.some(([name]) => name === 'hs_consume_nonce'),
      ).toBe(true);
      expect(
        database.rpc.mock.calls.some(([name]) => name === 'hs_ingest'),
      ).toBe(false);
    },
  );
  it('fails closed when the post-nonce policy lookup loses authorization', async () => {
    const original = database.rpc.getMockImplementation();
    database.rpc.mockImplementation(async (name, args) =>
      name === 'hs_ingest_policies'
        ? { data: null, error: { message: 'revoked household' } }
        : original?.(name, args),
    );
    const response = await handler(signedRequest());
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('revoked household');
    expect(database.rpc.mock.calls.some(([name]) => name === 'hs_ingest')).toBe(
      false,
    );
  });
  // This host used to make the schema's origin refinement throw out of
  // safeParse. The schema now rejects it cleanly, and the handler also guards
  // the parse, so a bad stored policy is a 403 and never an unhandled 500.
  it('answers 403 when a stored policy fails the schema parse', async () => {
    const unparseable = {
      ...sourceRegistry()[0].policy,
      listingOrigins: ['https://example.123'],
    };
    expect(sourcePolicySchema.safeParse(unparseable).success).toBe(false);
    const original = database.rpc.getMockImplementation();
    database.rpc.mockImplementation(async (name, args) =>
      name === 'hs_ingest_policies'
        ? { data: [unparseable], error: null }
        : original?.(name, args),
    );
    const response = await handler(signedRequest());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Source permissions unavailable',
    });
    expect(database.rpc.mock.calls.some(([name]) => name === 'hs_ingest')).toBe(
      false,
    );
  });
  it('rejects content encoding and over-limit advertised and actual body sizes', async () => {
    expect(
      (
        await handler(
          signedRequest({ headers: { 'content-encoding': 'gzip' } }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await handler(
          signedRequest({ headers: { 'content-length': '1048577' } }),
        )
      ).status,
    ).toBe(413);
    expect(
      (await handler(signedRequest({ actualBody: 'x'.repeat(1048577) })))
        .status,
    ).toBe(413);
    expect(database.rpc).not.toHaveBeenCalled();
  });
  it('reports missing configuration without echoing any secret', async () => {
    env.delete('SUPABASE_SERVICE_ROLE_KEY');
    const response = await handler(signedRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Ingestion is not configured',
    });
    expect(database.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ['key-not-in-secret', () => env.set('HS_INGEST_KEYS_JSON', '{}'), 401],
    [
      'bad-signature',
      () =>
        env.set(
          'HS_INGEST_KEYS_JSON',
          JSON.stringify({ 'test-key': `${secret}-different` }),
        ),
      401,
    ],
    [
      'secret-or-service-key-missing-or-invalid',
      () => env.delete('SUPABASE_SERVICE_ROLE_KEY'),
      503,
    ],
  ])(
    'logs only the reason %s and never a secret',
    async (reason, arrange, status) => {
      arrange();
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const response = await handler(signedRequest());
      expect(response.status).toBe(status);
      const text = logged.mock.calls.flat().join(' ');
      expect(text).toContain(reason);
      expect(text).not.toContain(secret);
      expect(text).not.toMatch(/[a-f0-9]{64}/);
      logged.mockRestore();
    },
  );
  it('logs a database error when the credential lookup fails', async () => {
    const original = database.rpc.getMockImplementation();
    database.rpc.mockImplementation(async (name, args) =>
      name === 'hs_ingest_credential'
        ? { data: null, error: { message: 'Invalid API key' } }
        : original?.(name, args),
    );
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handler(signedRequest());
    expect(response.status).toBe(401);
    expect(logged.mock.calls.flat().join(' ')).toContain(
      'credential-lookup-failed: Invalid API key',
    );
    logged.mockRestore();
  });
  it('rejects methods and paths before reading credentials', async () => {
    expect(
      (await handler(new Request(`https://local.example.invalid${path}`)))
        .status,
    ).toBe(405);
    expect(
      (await handler(signedRequest({ requestPath: '/other' }))).status,
    ).toBe(404);
    expect(database.rpc).not.toHaveBeenCalled();
  });
});
