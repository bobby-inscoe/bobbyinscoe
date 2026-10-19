import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { AcceptanceConfig, UserLabel } from './config';

// The checks talk to the backend only through these interfaces, so unit tests
// drive them with a fake and the real project is reached by one adapter below.

export interface ApiError {
  code: string;
  message: string;
}
export interface ApiResult {
  status: number;
  data: unknown;
  error: ApiError | null;
}
export interface Caller {
  /** A public-schema function through PostgREST, as the app calls it. */
  rpc(name: string, args: Record<string, unknown>): Promise<ApiResult>;
  /** A function in the private hs schema, through the Content-Profile header. */
  rpcInHsSchema(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ApiResult>;
  /** A direct table read, in the hs schema when `schema` is 'hs'. */
  readTable(table: string, schema: 'public' | 'hs'): Promise<ApiResult>;
}
export type SignInResult =
  | { ok: true; caller: Caller; userId: string }
  | { ok: false; message: string };
export interface Gateway {
  anon(): Caller;
  signIn(label: UserLabel): Promise<SignInResult>;
}

const TIMEOUT_MS = 20_000;

interface ErrorBody {
  code?: unknown;
  message?: unknown;
}

async function send(
  config: AcceptanceConfig,
  path: string,
  init: {
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string;
  },
): Promise<ApiResult> {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    method: init.method,
    headers: {
      apikey: config.publishableKey,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    body: init.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (response.ok) return { status: response.status, data, error: null };
  const body = (data ?? {}) as ErrorBody;
  return {
    status: response.status,
    data: null,
    error: {
      code: typeof body.code === 'string' ? body.code : '',
      message: typeof body.message === 'string' ? body.message : '',
    },
  };
}

function callerWith(
  config: AcceptanceConfig,
  client: SupabaseClient,
  authorization: Record<string, string>,
): Caller {
  return {
    // The public RPCs go through supabase-js, the call path the app uses, so
    // the error shape recorded here is the one the app's client receives.
    async rpc(name, args) {
      const { data, error, status } = await client.rpc(name, args);
      return {
        status,
        data: error ? null : data,
        error: error
          ? { code: error.code ?? '', message: error.message ?? '' }
          : null,
      };
    },
    rpcInHsSchema: (name, args) =>
      send(config, `rpc/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { ...authorization, 'Content-Profile': 'hs' },
        body: JSON.stringify(args),
      }),
    readTable: (table, schema) =>
      send(config, `${encodeURIComponent(table)}?select=*&limit=1`, {
        method: 'GET',
        headers:
          schema === 'hs'
            ? { ...authorization, 'Accept-Profile': 'hs' }
            : authorization,
      }),
  };
}

function newClient(config: AcceptanceConfig) {
  return createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createSupabaseGateway(config: AcceptanceConfig): Gateway {
  return {
    anon: () => callerWith(config, newClient(config), {}),
    async signIn(label) {
      const credentials = config.users[label];
      if (!credentials)
        return { ok: false, message: `No credentials for user ${label}.` };
      const client = newClient(config);
      const { data, error } = await client.auth.signInWithPassword(credentials);
      if (error || !data.session)
        return {
          ok: false,
          message: `Sign-in failed (status ${error?.status ?? 'none'}, code ${error?.code ?? 'none'}).`,
        };
      return {
        ok: true,
        userId: data.user.id,
        caller: callerWith(config, client, {
          Authorization: `Bearer ${data.session.access_token}`,
        }),
      };
    },
  };
}
