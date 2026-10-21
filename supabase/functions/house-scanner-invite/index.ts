import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// Serves a House Scanner invitation link. Both calls reserve the link for the email first, so an invalid or already
// bound link never creates an Auth account. With a password it creates the confirmed account, the link being the proof
// of the invitation; without one it mails the link to that address. The service key stays on this server.
const ORIGINS = new Set(['https://bobbyinscoe.com', 'http://localhost:5173']);
const inputSchema = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  email: z.email().max(254),
  password: z.string().min(8).max(72).optional(),
});
const reservationSchema = z.object({ ok: z.boolean() });

function response(status: number, body: object | null, origin: string | null) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(origin
        ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers':
              'authorization, apikey, content-type, x-client-info',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            Vary: 'Origin',
          }
        : {}),
    },
  });
}

const previewSchema = z.object({
  purpose: z.enum(['create', 'join']),
  householdName: z.string().nullable(),
  issuerName: z.string().nullable(),
});

// Mails the link through Resend. The preview is public to the anon role, so it runs with the anon key. Returns whether
// Resend accepted the message.
async function emailLink(
  url: string,
  email: string,
  link: string,
  token: string,
) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!resendKey || !anonKey) return false;
  try {
    const { data } = await createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).rpc('hs_invitation_preview', { p_token: token });
    const preview = previewSchema.parse(data);
    const from = preview.issuerName ?? 'A Shellter member';
    const what =
      preview.purpose === 'join'
        ? `join ${preview.householdName ?? 'their household'} on Shellter`
        : 'start your own household on Shellter';
    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Shellter <no-reply@auth.bobbyinscoe.com>',
        to: [email],
        subject: `${from} invited you to Shellter`,
        text: `${from} invited you to ${what}.\n\nOpen this link, then create your account or sign in with this email address:\n${link}\n\nThe link works once and expires in 7 days.`,
      }),
    });
    return sent.ok;
  } catch {
    return false;
  }
}

Deno.serve(async (request: Request) => {
  const requested = request.headers.get('origin');
  const origin = requested && ORIGINS.has(requested) ? requested : null;
  if (request.method === 'OPTIONS')
    return origin
      ? response(204, null, origin)
      : response(403, { error: 'Origin not allowed' }, null);
  if (request.method !== 'POST')
    return response(405, { error: 'Method not allowed' }, origin);
  if (!origin) return response(403, { error: 'Origin not allowed' }, null);
  let input: z.infer<typeof inputSchema>;
  try {
    input = inputSchema.parse(await request.json());
  } catch {
    return response(400, { error: 'Invalid request' }, origin);
  }
  let url: string;
  let key: string;
  try {
    url = z.url().parse(Deno.env.get('SUPABASE_URL'));
    key = z.string().min(20).parse(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  } catch {
    return response(500, { error: 'Not configured' }, origin);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = input.email.toLowerCase();
  const { data, error } = await admin.rpc('hs_invitation_reserve', {
    p_token: input.token,
    p_email: email,
  });
  const reservation = reservationSchema.safeParse(data);
  if (error || !reservation.success || !reservation.data.ok)
    return response(400, { error: 'This invitation cannot be used' }, origin);
  // Auth only returns to allow-listed URLs, still on the old path; the app redirects it to /shellter.
  const link = `${origin}/projects/house-scanner/invite?token=${input.token}`;
  if (input.password === undefined) {
    const sent = await emailLink(url, email, link, input.token);
    return sent
      ? response(200, { status: 'sent' }, origin)
      : response(502, { error: 'The email could not be sent' }, origin);
  }
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
  });
  // An address that already has an account is not told so; the caller signs in with the password and fails there.
  if (
    createError &&
    createError.code !== 'email_exists' &&
    !/already (been )?registered/i.test(createError.message)
  )
    return response(400, { error: 'The account could not be created' }, origin);
  return response(200, { status: 'created' }, origin);
});
