import { webcrypto } from 'node:crypto';
import {
  type IngestRequest,
  ingestRequestSchema,
} from '@/features/house-scanner/types/contracts';

// The path the function signs, whatever gateway prefix reaches it.
export const INGEST_PATH = '/functions/v1/house-scanner-ingest';
const REQUEST_TIMEOUT_MS = 30_000;
const encoder = new TextEncoder();

export interface SenderConfig {
  url: string;
  keyId: string;
  secret: string;
}

export interface SendReport {
  total: number;
  statuses: { action: IngestRequest['action']; status: number }[];
  // null status means no response (network error or timeout).
  stopped: { action: IngestRequest['action']; status: number | null } | null;
}

export interface SendDeps {
  fetch: typeof fetch;
  now: () => number;
}

// Messages never include the values read from the environment.
export function senderConfig(
  env: Record<string, string | undefined>,
): SenderConfig {
  const { HS_INGEST_URL, HS_INGEST_KEY_ID, HS_INGEST_SECRET } = env;
  let url: URL | null = null;
  try {
    url = new URL(HS_INGEST_URL ?? '');
  } catch {
    url = null;
  }
  const secure =
    url !== null &&
    (url.protocol === 'https:' ||
      (url.protocol === 'http:' && url.hostname === 'localhost'));
  if (
    url === null ||
    !secure ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith(INGEST_PATH)
  )
    throw new Error(
      `HS_INGEST_URL must be https (http only for localhost) and end with ${INGEST_PATH}.`,
    );
  if (!HS_INGEST_KEY_ID || !/^[A-Za-z0-9_-]{1,80}$/.test(HS_INGEST_KEY_ID))
    throw new Error('HS_INGEST_KEY_ID is missing or malformed.');
  if (
    !HS_INGEST_SECRET ||
    HS_INGEST_SECRET.length < 32 ||
    HS_INGEST_SECRET.length > 1024
  )
    throw new Error('HS_INGEST_SECRET must be 32 to 1024 characters.');
  return { url: url.href, keyId: HS_INGEST_KEY_ID, secret: HS_INGEST_SECRET };
}

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

export async function sign(
  secret: string,
  body: Uint8Array<ArrayBuffer>,
  timestamp: string,
  nonce: string,
) {
  const digest = hex(await webcrypto.subtle.digest('SHA-256', body));
  const key = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const canonical = `POST\n${INGEST_PATH}\n${timestamp}\n${nonce}\n${digest}`;
  return hex(
    await webcrypto.subtle.sign('HMAC', key, encoder.encode(canonical)),
  );
}

export const defaultSendDeps: SendDeps = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
};

/**
 * Posts prepared requests in order and stops at the first non-2xx. A request is
 * never retried: a retry needs a new nonce, and whether the first attempt
 * landed is for the operator to judge from the reported status.
 */
export async function sendRequests(
  requests: readonly IngestRequest[],
  config: SenderConfig,
  deps: SendDeps = defaultSendDeps,
): Promise<SendReport> {
  const parsed = requests.map((request) => ingestRequestSchema.parse(request));
  const actions = parsed.map((request) => request.action);
  if (
    actions.length < 2 ||
    actions[0] !== 'begin' ||
    actions.at(-1) !== 'publish' ||
    actions.slice(1, -1).some((action) => action !== 'stage')
  )
    throw new Error(
      'Requests must be begin, then stage requests, then publish.',
    );
  const report: SendReport = {
    total: parsed.length,
    statuses: [],
    stopped: null,
  };
  for (const request of parsed) {
    const body = encoder.encode(JSON.stringify(request));
    const timestamp = String(Math.floor(deps.now() / 1000));
    const nonce = hex(webcrypto.getRandomValues(new Uint8Array(16)));
    const signature = await sign(config.secret, body, timestamp, nonce);
    let status: number | null = null;
    try {
      const response = await deps.fetch(config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hs-key-id': config.keyId,
          'x-hs-timestamp': timestamp,
          'x-hs-nonce': nonce,
          'x-hs-signature': signature,
        },
        body,
        redirect: 'manual',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = response.status;
    } catch {
      status = null;
    }
    if (status === null || status < 200 || status > 299) {
      report.stopped = { action: request.action, status };
      return report;
    }
    report.statuses.push({ action: request.action, status });
  }
  return report;
}
