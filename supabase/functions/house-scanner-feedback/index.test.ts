import { beforeEach, expect, it, vi } from 'vitest';

const getUser = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser } }),
}));
let handler: (request: Request) => Promise<Response>;
const provider = vi.fn();
const body = {
  id: 'c5477c32-2d3f-44ea-8252-e12f50f07001',
  submittedAt: '2026-10-23T12:00:00.000Z',
  type: 'bug',
  title: 'Cannot save',
  description: 'Save failed after editing.',
  page: 'https://bobbyinscoe.com/shellter/listings',
};
const post = (input: unknown, token = 'synthetic') =>
  handler(
    new Request('https://example.invalid', {
      method: 'POST',
      headers: {
        origin: 'https://bobbyinscoe.com',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    }),
  );
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('Deno', {
    serve: (fn: typeof handler) => {
      handler = fn;
    },
    env: {
      get: (key: string) =>
        ({
          SUPABASE_URL: 'https://example.invalid',
          SUPABASE_ANON_KEY: 'synthetic',
          RESEND_API_KEY: 'synthetic',
          HS_FEEDBACK_TO_EMAIL: 'owner@example.com',
        })[key],
    },
  });
  getUser.mockReset().mockResolvedValue({
    data: {
      user: {
        id: 'member',
        email: 'member@example.com',
        email_confirmed_at: '2026-01-01',
      },
    },
    error: null,
  });
  provider.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', provider);
  await import('./index');
});
it('rejects unauthorized submissions before sending', async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: {} });
  expect((await post(body)).status).toBe(401);
  expect(provider).not.toHaveBeenCalled();
});
it('rejects whitespace, private URLs, forged recipients, and disguised images', async () => {
  for (const patch of [
    { title: ' ' },
    { page: `${body.page}?token=private` },
    { to: 'other@example.com' },
    { image: { type: 'image/png', content: btoa('not an image') } },
  ]) {
    expect((await post({ ...body, ...patch })).status).toBe(400);
  }
  expect(provider).not.toHaveBeenCalled();
});
it('sends only to the configured inbox with verified Reply-To and stable retry payload', async () => {
  expect((await post(body)).status).toBe(200);
  expect((await post(body)).status).toBe(200);
  const first = provider.mock.calls[0][1];
  expect(JSON.parse(first.body)).toMatchObject({
    to: ['owner@example.com'],
    reply_to: 'member@example.com',
    subject: '[Shellter bug] Cannot save',
  });
  expect(provider.mock.calls[1][1]).toMatchObject({
    body: first.body,
    headers: first.headers,
  });
});
it('reports provider failure and attaches a validated image', async () => {
  provider.mockResolvedValue(new Response('{}', { status: 500 }));
  expect(
    (
      await post({
        ...body,
        image: { type: 'image/png', content: btoa('\x89PNG\r\n\x1a\nfixture') },
      })
    ).status,
  ).toBe(502);
  expect(
    JSON.parse(provider.mock.calls[0][1].body).attachments[0].filename,
  ).toBe('screenshot.png');
});
