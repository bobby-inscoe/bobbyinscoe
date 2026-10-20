import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// Starts account setup for a House Scanner invitation. It reserves the link for the email first, so an invalid or
// already bound link never creates an Auth account, then asks Supabase Auth to email an invitation that returns to the
// same link. An address that already has an account gets the same answer and signs in instead, so the response never
// says whether an account exists. The service key stays on this server.
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
  // An existing account makes Auth refuse; the answer stays the same, and that person signs in instead.
  await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/projects/house-scanner/invite?token=${input.token}`,
  });
  return response(200, { status: 'sent' }, origin);
});
