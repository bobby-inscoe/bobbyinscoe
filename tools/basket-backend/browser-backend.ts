import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { BrowserContext } from '@playwright/test';
import { addIdentity, asIdentity } from './test-database';

// Auth transport is synthetic; RPC requests execute the real migration as the authenticated database role.
export function browserBackend(
  db: PGlite,
  failures: { loseHandoverResponse?: boolean } = {},
) {
  const access = new Map<string, string>(),
    pendingEmails = new Map<string, string>();
  async function user(id: string) {
    const row = (
      await db.query<{
        id: string;
        email: string | null;
        is_anonymous: boolean;
        email_confirmed_at: string | null;
      }>('select * from auth.users where id=$1', [id])
    ).rows[0];
    return {
      ...row,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {
        provider: row.is_anonymous ? 'anonymous' : 'email',
        providers: [row.is_anonymous ? 'anonymous' : 'email'],
      },
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
  async function session(id: string) {
    const profile = await user(id),
      expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, aud: 'authenticated', role: 'authenticated', exp: expiresAt, iat: expiresAt - 3600, is_anonymous: profile.is_anonymous })).toString('base64url')}.test-signature`;
    access.set(token, id);
    return {
      access_token: token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      refresh_token: randomUUID(),
      user: profile,
    };
  }
  return async (context: BrowserContext) => {
    await context.routeWebSocket('**/realtime/v1/websocket**', (socket) =>
      socket.close(),
    );
    await context.route('http://127.0.0.1:54331/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-headers': '*',
          },
        });
        return;
      }
      const id = access.get(
        (request.headers().authorization ?? '').replace(/^Bearer /, ''),
      );
      const body = request.postData()
        ? (request.postDataJSON() as Record<string, unknown>)
        : {};
      const reply = (value: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify(value),
        });
      try {
        if (url.pathname === '/auth/v1/signup') {
          const created = randomUUID();
          await addIdentity(db, created);
          await reply(await session(created));
        } else if (url.pathname === '/auth/v1/user' && id) {
          if (request.method() === 'PUT')
            pendingEmails.set(String(body.email), id);
          await reply(await user(id));
        } else if (url.pathname === '/auth/v1/otp') {
          const row = (
            await db.query<{ id: string }>(
              'select id from auth.users where email=$1 and not is_anonymous',
              [body.email],
            )
          ).rows[0];
          if (row) pendingEmails.set(String(body.email), row.id);
          await reply({});
        } else if (url.pathname === '/auth/v1/verify') {
          const target = pendingEmails.get(String(body.email));
          if (!target || body.token !== '123456') {
            await reply({ msg: 'Invalid verification code.' }, 400);
            return;
          }
          await db.query(
            'update auth.users set email=$2,email_confirmed_at=now(),is_anonymous=false where id=$1',
            [target, body.email],
          );
          await reply(await session(target));
        } else if (url.pathname === '/auth/v1/logout') await reply({});
        else if (url.pathname === '/rest/v1/rpc/basket_command' && id) {
          const result = await asIdentity(
            db,
            id,
            'select public.basket_command($1,$2::jsonb) as value',
            [body.p_request, JSON.stringify(body.p_action)],
          );
          if (
            failures.loseHandoverResponse &&
            typeof body.p_action === 'object' &&
            body.p_action &&
            'type' in body.p_action &&
            body.p_action.type === 'handover_finish'
          ) {
            failures.loseHandoverResponse = false;
            await route.abort('failed');
          } else await reply(result);
        } else if (url.pathname === '/rest/v1/rpc/basket_snapshot' && id)
          await reply(
            await asIdentity(
              db,
              id,
              'select public.basket_snapshot($1) as value',
              [body.p_basket ?? null],
            ),
          );
        else
          await reply({ message: 'No synthetic session.', code: '42501' }, 401);
      } catch (cause) {
        const code =
          cause && typeof cause === 'object' && 'code' in cause
            ? String(cause.code)
            : 'P0001';
        await reply(
          {
            message:
              cause instanceof Error
                ? cause.message
                : 'Database request failed.',
            code,
            details: null,
            hint: null,
          },
          code === '42501' ? 403 : 400,
        );
      }
    });
  };
}
