import { beforeEach, describe, expect, it, vi } from 'vitest';

const admin = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { admin: { inviteUserByEmail: vi.fn() } },
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
  admin.auth.admin.inviteUserByEmail.mockReset();
  admin.auth.admin.inviteUserByEmail.mockResolvedValue({ error: null });
  await import('./index');
});

describe('invitation account setup', () => {
  it('reserves the link for the email, then sends an Auth invitation back to it', async () => {
    const reply = await post({ token, email: 'New@Example.invalid' });
    expect(reply.status).toBe(200);
    expect(reply.headers.get('access-control-allow-origin')).toBe(origin);
    expect(admin.rpc).toHaveBeenCalledWith('hs_invitation_reserve', {
      p_token: token,
      p_email: 'new@example.invalid',
    });
    expect(admin.auth.admin.inviteUserByEmail).toHaveBeenCalledWith(
      'new@example.invalid',
      { redirectTo: `${origin}/projects/house-scanner/invite?token=${token}` },
    );
  });

  it('creates no account for a link the database refuses', async () => {
    admin.rpc.mockResolvedValueOnce({ data: { ok: false }, error: null });
    expect((await post({ token, email: 'new@example.invalid' })).status).toBe(
      400,
    );
    admin.rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    expect((await post({ token, email: 'new@example.invalid' })).status).toBe(
      400,
    );
    expect(admin.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it('answers the same when the address already has an account', async () => {
    admin.auth.admin.inviteUserByEmail.mockResolvedValueOnce({
      error: {
        message: 'A user with this email address has already been registered',
      },
    });
    const reply = await post({ token, email: 'known@example.invalid' });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ status: 'sent' });
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
