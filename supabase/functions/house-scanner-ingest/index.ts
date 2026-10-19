import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

import {
  ingestRequestSchema,
  sourcePolicySchema,
} from '@/features/house-scanner/types/contracts.ts';
import {
  assertObservationAllowed,
  assertSourceAllowed,
} from '@/features/house-scanner/utils/source-policy.ts';

const MAX_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const credentialSchema = z.strictObject({
  householdId: z.uuid(),
  sourceIds: z.array(z.string()).min(1).max(20),
  scopes: z.array(z.literal('ingest')).min(1),
});
const resultSchema = z.strictObject({
  runId: z.uuid(),
  state: z.enum(['staging', 'published', 'failed']),
  editionId: z.uuid().nullable().optional(),
});
function response(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
function parsePolicies(data: unknown) {
  return z.array(sourcePolicySchema).max(20).safeParse(data);
}
function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
async function boundedBody(request: Request) {
  if (!request.body) throw new Error('Body missing');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new Error('Body too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
// The caller always gets the same generic body; the reason code goes to the function logs only
// and never includes a secret, key, signature or body.
function refuse(status: 401 | 503, reason: string) {
  console.error(`house-scanner-ingest refused: ${reason}`);
  return response(status, {
    error:
      status === 401 ? 'Request not authorized' : 'Ingestion is not configured',
  });
}
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST')
    return response(405, { error: 'Method not allowed' });
  const path = new URL(request.url).pathname;
  if (
    !['/house-scanner-ingest', '/functions/v1/house-scanner-ingest'].includes(
      path,
    )
  )
    return response(404, { error: 'Not found' });
  if (
    request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !==
      'application/json' ||
    request.headers.has('content-encoding')
  )
    return response(415, { error: 'JSON required' });
  const keyId = request.headers.get('x-hs-key-id') ?? '';
  const timestamp = request.headers.get('x-hs-timestamp') ?? '';
  const nonce = request.headers.get('x-hs-nonce') ?? '';
  const signature = request.headers.get('x-hs-signature') ?? '';
  if (
    !/^[A-Za-z0-9_-]{1,80}$/.test(keyId) ||
    !/^\d{10}$/.test(timestamp) ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    return response(401, { error: 'Request not authorized' });
  const contentLength = request.headers.get('content-length');
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BYTES)
  )
    return response(413, { error: 'Request too large' });
  let body: Awaited<ReturnType<typeof boundedBody>>;
  try {
    body = await boundedBody(request);
  } catch {
    return response(413, { error: 'Body missing or too large' });
  }
  const digest = hex(await crypto.subtle.digest('SHA-256', body));
  let secret: string;
  let databaseUrl: string;
  let databaseKey: string;
  try {
    const keys = z
      .record(z.string(), z.string().min(32).max(1024))
      .parse(JSON.parse(Deno.env.get('HS_INGEST_KEYS_JSON') ?? '{}'));
    if (!Object.hasOwn(keys, keyId)) return refuse(401, 'key-not-in-secret');
    secret = keys[keyId];
    databaseUrl = z.url().parse(Deno.env.get('SUPABASE_URL'));
    databaseKey = z
      .string()
      .min(20)
      .parse(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  } catch {
    return refuse(503, 'secret-or-service-key-missing-or-invalid');
  }
  const signed = encoder.encode(
    `${request.method}\n/functions/v1/house-scanner-ingest\n${timestamp}\n${nonce}\n${digest}`,
  );
  const hmac = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signatureBytes = Uint8Array.from(signature.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
  // WebCrypto performs the fixed-length MAC comparison; never compare signature strings.
  if (!(await crypto.subtle.verify('HMAC', hmac, signatureBytes, signed)))
    return refuse(401, 'bad-signature');
  const database = createClient(databaseUrl, databaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: credential, error: credentialError } = await database.rpc(
    'hs_ingest_credential',
    { p_key_id: keyId },
  );
  const scope = credentialSchema.safeParse(credential);
  if (credentialError || !scope.success)
    return refuse(
      401,
      credentialError
        ? `credential-lookup-failed: ${credentialError.message}`
        : 'credential-not-active',
    );
  const { error: replayError } = await database.rpc('hs_consume_nonce', {
    p_key_id: keyId,
    p_nonce: nonce,
    p_timestamp: Number(timestamp),
  });
  if (replayError)
    return response(409, { error: 'Request replayed or credential invalid' });
  // This RPC checks revocation again after nonce consumption. hs_ingest checks it once more in its transaction.
  const { data: policyData, error: policyError } = await database.rpc(
    'hs_ingest_policies',
    { p_key_id: keyId },
  );
  // The schema's origin refinement calls new URL(), which can throw instead of failing. A stored policy that makes
  // it throw is an unusable policy, not a server fault, and the nonce is already consumed.
  let policies: ReturnType<typeof parsePolicies> | null = null;
  try {
    policies = parsePolicies(policyData);
  } catch {
    policies = null;
  }
  if (policyError || !policies?.success)
    return response(403, { error: 'Source permissions unavailable' });
  let input: z.infer<typeof ingestRequestSchema>;
  try {
    input = ingestRequestSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)),
    );
    const sourceIds =
      input.action === 'begin'
        ? input.sourceIds
        : input.action === 'stage'
          ? [input.sourceId]
          : input.results.map((result) => result.sourceId);
    if (
      new Set(sourceIds).size !== sourceIds.length ||
      sourceIds.some((source) => !scope.data.sourceIds.includes(source))
    )
      throw new Error('Invalid source scope');
    if (
      input.action === 'begin' &&
      new Set(input.profileVersions.map((profile) => profile.profileId))
        .size !== input.profileVersions.length
    )
      throw new Error('Duplicate profile');
    const now = new Date();
    for (const sourceId of sourceIds) {
      // Failed results publish no source content, so permission loss can be reported without replacing its prior data.
      if (
        input.action === 'publish' &&
        input.results.find((result) => result.sourceId === sourceId)?.status ===
          'failed'
      )
        continue;
      const policy = policies.data.find(
        (candidate) => candidate.sourceId === sourceId,
      );
      if (!policy) throw new Error('Missing source policy');
      assertSourceAllowed(policy, now);
      if (input.action === 'stage')
        for (const observation of input.observations)
          assertObservationAllowed(policy, observation, now);
    }
  } catch {
    return response(422, { error: 'Invalid batch or source permission' });
  }
  const { data, error } = await database.rpc('hs_ingest', {
    p_key_id: keyId,
    p_body_hash: digest,
    p_request: input,
  });
  const result = resultSchema.safeParse(data);
  if (error || !result.success)
    return response(409, {
      error: 'Run conflict, invalid scope, profile revision or publication',
    });
  return response(200, result.data);
});
