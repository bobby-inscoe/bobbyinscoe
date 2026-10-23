import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const MAX_BODY = 7_100_000;
const schema = z.strictObject({
  id: z.uuid(),
  submittedAt: z.iso.datetime(),
  type: z.enum(['bug', 'feature']),
  title: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[^\r\n]+$/),
  description: z.string().trim().min(1).max(5000),
  page: z
    .string()
    .max(500)
    .refine((page) => {
      try {
        const url = new URL(page);
        return (
          ['https://bobbyinscoe.com', 'http://localhost:5173'].includes(
            url.origin,
          ) &&
          !url.search &&
          !url.hash &&
          !url.username &&
          !url.password
        );
      } catch {
        return false;
      }
    }),
  image: z
    .strictObject({
      content: z.string().max(7_000_000),
      type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    })
    .optional(),
});

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin') ?? '';
  const allowed = ['https://bobbyinscoe.com', 'http://localhost:5173'].includes(
    origin,
  );
  const reply = (status: number, body: object | null) =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        Vary: 'Origin',
        ...(allowed
          ? {
              'Access-Control-Allow-Origin': origin,
              'Access-Control-Allow-Headers':
                'authorization, apikey, content-type, x-client-info',
              'Access-Control-Allow-Methods': 'POST, OPTIONS',
            }
          : {}),
      },
    });
  if (!allowed) return reply(403, { error: 'Origin not allowed' });
  if (request.method === 'OPTIONS') return reply(204, null);
  if (request.method !== 'POST')
    return reply(405, { error: 'Method not allowed' });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_ANON_KEY');
    const resend = Deno.env.get('RESEND_API_KEY');
    const recipient = Deno.env.get('HS_FEEDBACK_TO_EMAIL');
    if (
      !url ||
      !key ||
      !resend ||
      !recipient ||
      !z.email().safeParse(recipient).success
    )
      return reply(503, { error: 'Not configured' });
    const token = request.headers
      .get('authorization')
      ?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return reply(401, { error: 'Sign in required' });
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(token);
    const user = data.user;
    if (error || !user?.email || !user.email_confirmed_at || user.is_anonymous)
      return reply(401, { error: 'Sign in required' });
    if (!request.body) return reply(400, { error: 'Invalid request' });
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        return reply(413, { error: 'Request too large' });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let input: z.infer<typeof schema>;
    try {
      input = schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      return reply(400, { error: 'Invalid request' });
    }
    let extension = '';
    if (input.image) {
      if (input.type !== 'bug')
        return reply(400, { error: 'Images are for bugs only' });
      let image: string;
      try {
        image = atob(input.image.content);
      } catch {
        return reply(400, { error: 'Invalid image' });
      }
      const png = image.startsWith('\x89PNG\r\n\x1a\n');
      const jpeg = image.startsWith('\xff\xd8\xff');
      const webp = image.startsWith('RIFF') && image.slice(8, 12) === 'WEBP';
      if (
        !image.length ||
        image.length > 5 * 1024 * 1024 ||
        !(input.image.type === 'image/png'
          ? png
          : input.image.type === 'image/jpeg'
            ? jpeg
            : webp)
      )
        return reply(400, { error: 'Invalid image' });
      extension = png ? 'png' : jpeg ? 'jpg' : 'webp';
    }
    const sent = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${resend}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `feedback/${user.id}/${input.id}`,
      },
      body: JSON.stringify({
        from: 'Shellter <no-reply@auth.bobbyinscoe.com>',
        to: [recipient],
        reply_to: user.email,
        subject: `[Shellter ${input.type === 'bug' ? 'bug' : 'feature request'}] ${input.title}`,
        text: `${input.description}\n\nPage: ${input.page}\nFrom: ${user.email}\nSubmitted: ${input.submittedAt}`,
        ...(input.image
          ? {
              attachments: [
                {
                  filename: `screenshot.${extension}`,
                  content: input.image.content,
                },
              ],
            }
          : {}),
      }),
    });
    return sent.ok
      ? reply(200, { status: 'sent' })
      : reply(502, { error: 'Email could not be sent' });
  } catch {
    return reply(502, { error: 'Email could not be sent' });
  }
});
