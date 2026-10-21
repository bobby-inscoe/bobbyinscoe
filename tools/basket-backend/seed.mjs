import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const root = fileURLToPath(new URL('../../', import.meta.url));
if (existsSync(`${root}.env.local`)) process.loadEnvFile(`${root}.env.local`);
const { values } = parseArgs({
  options: { hosted: { type: 'boolean' }, 'project-ref': { type: 'string' } },
});
const url = new URL(
  process.env.VITE_BASKET_SUPABASE_URL ?? 'http://127.0.0.1:54331',
);
const key = process.env.VITE_BASKET_SUPABASE_PUBLISHABLE_KEY;
const local = ['localhost', '127.0.0.1'].includes(url.hostname);
if (!key?.startsWith('sb_publishable_'))
  throw new Error('Set the Basket publishable key in .env.local.');
if (
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== '/'
)
  throw new Error('Use a plain Basket project URL.');
if (
  !local &&
  (!values.hosted ||
    url.protocol !== 'https:' ||
    url.hostname !== `${values['project-ref']}.supabase.co`)
)
  throw new Error(
    'Hosted seeding requires --hosted and the exact --project-ref.',
  );
if (process.env.VITE_HOUSE_SCANNER_SUPABASE_URL === url.origin)
  throw new Error('Refusing to seed the House Scanner project.');
const suffix = url.host.replace(/[^a-z0-9.-]/gi, '_');
const statePath = fileURLToPath(
  new URL(`./seed.${suffix}.private.json`, import.meta.url),
);
const temporary = fileURLToPath(
  new URL(`./seed.${suffix}.tmp.private.json`, import.meta.url),
);
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, 'utf8'))
  : {
      url: url.origin,
      sessions: {},
      ids: {
        basket: randomUUID(),
        kit: randomUUID(),
        saved: randomUUID(),
        extra: randomUUID(),
        link: randomUUID(),
        items: [randomUUID(), randomUUID(), randomUUID()],
      },
      requests: Object.fromEntries(
        ['create', 'kit', 'attach', 'extra', 'link', 'join'].map((name) => [
          name,
          randomUUID(),
        ]),
      ),
      token: randomBytes(32).toString('hex'),
      seeded: false,
    };
assert.equal(
  state.url,
  url.origin,
  'Seed session belongs to a different project.',
);
function save() {
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, statePath);
}
async function clientFor(name) {
  const client = createClient(url.origin, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `basket.seed.${name}`,
    },
  });
  const { data, error } = state.sessions[name]
    ? await client.auth.setSession(state.sessions[name])
    : await client.auth.signInAnonymously();
  if (error || !data.session)
    throw new Error(
      'Could not start the synthetic ' +
        name +
        ' session: ' +
        (error?.message ?? 'no session'),
    );
  state.sessions[name] = data.session;
  save();
  return client;
}
async function command(client, name, action) {
  const { error } = await client.rpc('basket_command', {
    p_request: state.requests[name],
    p_action: action,
  });
  if (error) throw new Error(`Seed ${name} failed: ${error.message}`);
}
async function snapshot(client) {
  const { data, error } = await client.rpc('basket_snapshot', {
    p_basket: state.ids.basket,
  });
  if (error) throw new Error(`Seed verification failed: ${error.message}`);
  return data;
}
try {
  const owner = await clientFor('owner'),
    friend = await clientFor('friend'),
    id = state.ids;
  if (!state.seeded) {
    await command(owner, 'create', {
      type: 'create',
      id: id.basket,
      title: 'Example weekend away',
      name: 'Alex (example)',
    });
    await command(owner, 'kit', {
      type: 'kit_save',
      id: id.kit,
      title: 'Example packing essentials',
      items: ['Toothbrush', 'Socks', 'Phone charger'].map((text, index) => ({
        id: id.items[index],
        text,
      })),
    });
    await command(owner, 'attach', {
      type: 'kit_attach',
      basketId: id.basket,
      id: id.saved,
      kitId: id.kit,
    });
    await command(owner, 'extra', {
      type: 'item_add',
      basketId: id.basket,
      id: id.extra,
      text: 'Train tickets (this trip)',
    });
    await command(owner, 'link', {
      type: 'link_set',
      basketId: id.basket,
      id: id.link,
      token: state.token,
    });
    await command(friend, 'join', {
      type: 'join',
      token: state.token,
      name: 'Sam (example)',
    });
  }
  const a = await snapshot(owner),
    b = await snapshot(friend);
  assert.equal(a.basket.id, id.basket);
  assert.equal(a.basket.role, 'owner');
  assert.equal(a.kits.filter((kit) => kit.id === id.kit).length, 1);
  assert.equal(
    b.kits.some((kit) => kit.id === id.kit),
    false,
    'Personal kits must stay private.',
  );
  assert.deepEqual(
    a.basket.items,
    b.basket.items,
    'Both guests must see the same items.',
  );
  assert.equal(
    a.basket.savedKits.filter((kit) => kit.id === id.saved).length,
    1,
  );
  state.seeded = true;
  save();
  console.log(
    'Synthetic Basket fixture verified in ' +
      url.hostname +
      '. Re-running does not duplicate it.',
  );
  if (a.basket.linkId === id.link)
    console.log(
      'Join as a member: ' +
        (process.env.BASKET_APP_URL ?? 'http://localhost:5173') +
        '/basket#join=' +
        state.token,
    );
  else
    console.log(
      'The example join link has changed or was disabled; it was not replaced.',
    );
  console.log(
    'Private synthetic owner and friend sessions are stored in an ignored file beside this script.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Seeding failed.');
  process.exitCode = 1;
}
