import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import { z } from 'zod';
import {
  type Action,
  actionSchema,
  idSchema,
  snapshotSchema,
} from '@/features/basket/types/contracts';

const settingsSchema = z.strictObject({
  url: z.url().refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/' &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname)))
    );
  }),
  key: z.string().regex(/^sb_publishable_[A-Za-z0-9_-]{20,}$/),
});
export type BasketSettings = z.infer<typeof settingsSchema>;
export class BasketError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'BasketError';
  }
}
function check(error: { message: string; code?: string } | null) {
  if (!error) return;
  if (['23514', '23502', '22P02', '23505'].includes(error.code ?? ''))
    throw new BasketError(
      'Check the name and items, then try again.',
      error.code,
    );
  throw new BasketError(error.message, error.code);
}
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export class BasketClient {
  readonly sdk: SupabaseClient;
  private readonly uncertain = new Map<string, string>();
  private pending: {
    email: string;
    existing: boolean;
    sdk: SupabaseClient;
    token?: string;
    request?: string;
  } | null = null;
  constructor(private readonly settings: BasketSettings) {
    this.sdk = createClient(settings.url, settings.key, {
      auth: {
        storageKey: `basket.auth.${new URL(settings.url).host}`,
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  async user(): Promise<User | null> {
    const { data, error } = await this.sdk.auth.getSession();
    check(error);
    return data.session?.user ?? null;
  }
  async ensureGuest(captchaToken?: string) {
    const current = await this.user();
    if (current) return current;
    const { data, error } = await this.sdk.auth.signInAnonymously({
      options: { captchaToken },
    });
    check(error);
    if (!data.user)
      throw new BasketError(
        'Your browser session could not be started. Please try again.',
      );
    return data.user;
  }
  async snapshot(basketId?: string) {
    const { data, error } = await this.sdk.rpc('basket_snapshot', {
      p_basket: basketId ? idSchema.parse(basketId) : null,
    });
    check(error);
    return snapshotSchema.parse(data);
  }
  async command(action: Action, request?: string) {
    const validated = actionSchema.parse(action),
      key = JSON.stringify(validated);
    const args = {
      p_request: request ?? this.uncertain.get(key) ?? crypto.randomUUID(),
      p_action: validated,
    };
    const { data, error } = await this.sdk.rpc('basket_command', args);
    if (error && !error.code) this.uncertain.set(key, args.p_request);
    else this.uncertain.delete(key);
    check(error);
    return z.strictObject({ id: idSchema.optional() }).parse(data);
  }
  watch(
    basketId: string,
    onChange: () => void,
    onState: (connected: boolean) => void,
  ) {
    const channel = this.sdk
      .channel(`basket:${idSchema.parse(basketId)}:${crypto.randomUUID()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'basket_signals',
          filter: `basket_id=eq.${basketId}`,
        },
        onChange,
      )
      .subscribe((status) => {
        onState(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') onChange();
      });
    return () => {
      void this.sdk.removeChannel(channel);
    };
  }
  async sendAccountCode(email: string, existing: boolean) {
    const address = z.email().parse(email.trim());
    const current = await this.ensureGuest();
    if (!current.is_anonymous)
      throw new BasketError('You are already signed in.');
    if (existing) {
      let token: string | undefined = randomToken();
      const request = crypto.randomUUID();
      try {
        await this.command({ type: 'handover_prepare', token });
      } catch (cause) {
        if (
          cause instanceof BasketError &&
          (cause.code === '42501' ||
            cause.message === 'Only a guest session needs a handover.')
        )
          token = undefined;
        else throw cause;
      }
      // A separate client preserves the guest session until the verified transfer succeeds.
      const sdk = createClient(this.settings.url, this.settings.key, {
        auth: {
          storageKey: `basket.account.${crypto.randomUUID()}`,
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });
      const { error } = await sdk.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: false },
      });
      check(error);
      this.pending = { email: address, existing, sdk, token, request };
    } else {
      const { error } = await this.sdk.auth.updateUser({ email: address });
      check(error);
      this.pending = { email: address, existing, sdk: this.sdk };
    }
  }
  async verifyAccountCode(code: string) {
    const pending = this.pending;
    if (!pending)
      throw new BasketError(
        'Request a fresh email code first. Your guest baskets are still here.',
      );
    let session = pending.existing
      ? (await pending.sdk.auth.getSession()).data.session
      : null;
    if (!session) {
      const { data, error } = await pending.sdk.auth.verifyOtp({
        email: pending.email,
        token: z
          .string()
          .regex(/^\d{6,10}$/)
          .parse(code.trim()),
        type: pending.existing ? 'email' : 'email_change',
      });
      check(error);
      session = data.session;
    }
    if (!session || session.user.is_anonymous)
      throw new BasketError(
        'Your email could not be verified. Request a new code.',
      );
    if (pending.existing) {
      if (pending.token && pending.request) {
        const { error } = await pending.sdk.rpc('basket_command', {
          p_request: pending.request,
          p_action: { type: 'handover_finish', token: pending.token },
        });
        check(error);
      }
      const { error: sessionError } = await this.sdk.auth.setSession(session);
      check(sessionError);
    }
    this.pending = null;
  }
  async signOut() {
    const { error } = await this.sdk.auth.signOut({ scope: 'local' });
    check(error);
  }
}

let cached: { settings: BasketSettings; client: BasketClient } | null = null;
export function getBasketClient() {
  const settings = settingsSchema.safeParse({
    url: import.meta.env.VITE_BASKET_SUPABASE_URL,
    key: import.meta.env.VITE_BASKET_SUPABASE_PUBLISHABLE_KEY,
  });
  if (
    !settings.success ||
    settings.data.url === import.meta.env.VITE_HOUSE_SCANNER_SUPABASE_URL
  )
    return null;
  if (
    cached?.settings.url === settings.data.url &&
    cached.settings.key === settings.data.key
  )
    return cached.client;
  const client = new BasketClient(settings.data);
  cached = { settings: settings.data, client };
  return client;
}
