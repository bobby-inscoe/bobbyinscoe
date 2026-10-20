import { beforeEach, describe, expect, it, vi } from 'vitest';

const admin = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { admin: { createUser: vi.fn() } },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => admin }));
const token = 'a'.repeat(64);
const origin = 'https://bobbyinscoe.com';
let handler: (request: Request) => Promise<Response>;
const env = new Map<string, string>();

const post = (body: unknown, from: string | null = origin) =>
  handler(
    new Request('https://functions.example.invalid/house-scanner-invite', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(from ? { origin: from } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

beforeEach(async () => {
  vi.resetModules();
  env.clear();
  env.set('SUPABASE_URL', 'https://database.example.invalid');
  env.set('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-role-test-only');
  vi.stubGlobal('Deno', {
    serve: (callback: typeof handler) => {
      handler = callback;
    },
    env: { get: (key: string) => env.get(key) },
  });
  admin.rpc.mockReset();
  admin.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  admin.auth.admin.createUser.mockReset();
  admin.auth.admin.createUser.mockResolvedValue({ error: null });
  await import('./index');
});

describe('invitation account setup', () => {
  it('reserves the link for the email, then creates a confirmed account with the password', async () => {
    const reply = await post({
      token,
      email: 'New@Example.invalid',
      password: 'a long password',
    });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ status: 'created' });
    expect(reply.headers.get('access-control-allow-origin')).toBe(origin);
    expect(admin.rpc).toHaveBeenCalledWith('hs_invitation_reserve', {
      p_token: token,
      p_email: 'new@example.invalid',
    });
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith({
      email: 'new@example.invalid',
      password: 'a long password',
      email_confirm: true,
    });
  });

  it('creates no account for a link the database refuses', async () => {
    const body = {
      token,
      email: 'new@example.invalid',
      password: 'long enough',
    };
    admin.rpc.mockResolvedValueOnce({ data: { ok: false }, error: null });
    expect((await post(body)).status).toBe(400);
    admin.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    expect((await post(body)).status).toBe(400);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('answers the same when the address already has an account', async () => {
    admin.auth.admin.createUser.mockResolvedValueOnce({
      error: { code: 'email_exists', message: 'exists' },
    });
    const reply = await post({
      token,
      email: 'known@example.invalid',
      password: 'a long password',
    });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ status: 'created' });
  });

  it('refuses a short password before touching the database', async () => {
    expect(
      (await post({ token, email: 'a@b.invalid', password: 'short' })).status,
    ).toBe(400);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('mails the link through Resend when there is no password', async () => {
    env.set('RESEND_API_KEY', 'synthetic-resend-key');
    env.set('SUPABASE_ANON_KEY', 'synthetic-anon-key');
    admin.rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'hs_invitation_preview'
          ? { purpose: 'join', householdName: 'Home', issuerName: 'Casey' }
          : { ok: true },
      error: null,
    }));
    const send = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', send);
    const reply = await post({ token, email: 'known@example.invalid' });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ status: 'sent' });
    expect(send).toHaveBeenCalledTimes(1);
    const [endpoint, init] = send.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(endpoint).toBe('https://api.resend.com/emails');
    const mail = JSON.parse(String(init.body));
    expect(mail.to).toEqual(['known@example.invalid']);
    expect(mail.text).toContain('Casey invited you to join Home');
    expect(mail.text).toContain(`invite?token=${token}`);
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
  });

  it('reports a failed send when no mail key is set', async () => {
    const send = vi.fn();
    vi.stubGlobal('fetch', send);
    expect((await post({ token, email: 'known@example.invalid' })).status).toBe(
      502,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses other origins, methods and malformed input before touching the database', async () => {
    expect(
      (await post({ token, email: 'a@b.invalid' }, 'https://evil.example'))
        .status,
    ).toBe(403);
    expect((await post({ token, email: 'a@b.invalid' }, null)).status).toBe(
      403,
    );
    expect((await post({ token: 'short', email: 'a@b.invalid' })).status).toBe(
      400,
    );
    expect((await post({ token, email: 'not-an-email' })).status).toBe(400);
    expect((await post({ token, email: 'a@b.invalid', extra: 1 })).status).toBe(
      400,
    );
    const get = await handler(
      new Request('https://functions.example.invalid/house-scanner-invite', {
        headers: { origin },
      }),
    );
    expect(get.status).toBe(405);
    const preflight = await handler(
      new Request('https://functions.example.invalid/house-scanner-invite', {
        method: 'OPTIONS',
        headers: { origin },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it('fails closed without a service key', async () => {
    env.delete('SUPABASE_SERVICE_ROLE_KEY');
    expect((await post({ token, email: 'a@b.invalid' })).status).toBe(500);
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
