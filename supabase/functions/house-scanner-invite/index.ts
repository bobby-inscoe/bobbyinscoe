import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// Starts account setup for a House Scanner invitation. It reserves the link for the email first, so an invalid or
// already bound link never creates an Auth account, then asks Supabase Auth to email an invitation that returns to the
// same link. An address that already has an account gets the same link from an app email instead, and the response
// never says whether an account exists. The service key stays on this server.
const ORIGINS = new Set(['https://bobbyinscoe.com', 'http://localhost:5173']);
const inputSchema = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  email: z.email().max(254),
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

// Mails the link to someone who already has an account, through Resend. Without RESEND_API_KEY it does nothing, and
// a failure never changes the answer. The preview is public to the anon role, so it runs with the anon key.
async function emailExistingAccount(
  url: string,
  email: string,
  link: string,
  token: string,
) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!resendKey || !anonKey) return;
  try {
    const { data } = await createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).rpc('hs_invitation_preview', { p_token: token });
    const preview = previewSchema.parse(data);
    const from = preview.issuerName ?? 'A House Scanner member';
    const what =
      preview.purpose === 'join'
        ? `join ${preview.householdName ?? 'their household'} on House Scanner`
        : 'start your own household on House Scanner';
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'House Scanner <no-reply@auth.bobbyinscoe.com>',
        to: [email],
        subject: `${from} invited you to House Scanner`,
        text: `${from} invited you to ${what}.\n\nOpen this link and sign in with this email address:\n${link}\n\nThe link works once and expires in 7 days.`,
      }),
    });
  } catch {
    // The sender still has the link on their clipboard.
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
  const link = `${origin}/projects/house-scanner/invite?token=${input.token}`;
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: link },
  );
  // An existing account makes Auth send nothing, so that person gets the same link from the app's own email. The
  // answer stays the same either way.
  if (
    inviteError &&
    (inviteError.code === 'email_exists' ||
      /already (been )?registered/i.test(inviteError.message))
  )
    await emailExistingAccount(url, email, link, input.token);
  return response(200, { status: 'sent' }, origin);
});
