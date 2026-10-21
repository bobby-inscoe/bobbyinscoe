import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { snapshotSchema } from '@/features/basket/types/contracts';
import { addIdentity, asIdentity, createDatabase } from './test-database';

let db: PGlite;
beforeAll(async () => {
  db = await createDatabase();
});
afterAll(async () => {
  await db?.close();
});
const cmd = (user: string | null, action: unknown, request = randomUUID()) =>
  asIdentity(db, user, 'select public.basket_command($1,$2::jsonb) as value', [
    request,
    JSON.stringify(action),
  ]);
const read = async (user: string, basket: string | null = null) =>
  snapshotSchema.parse(
    await asIdentity(db, user, 'select public.basket_snapshot($1) as value', [
      basket,
    ]),
  );
async function person(guest = true) {
  const id = randomUUID();
  await addIdentity(db, id, guest);
  return id;
}
async function basket(user: string) {
  const id = randomUUID();
  await cmd(user, { type: 'create', id, title: 'Groceries', name: 'Alex' });
  return id;
}
async function share(user: string, basketId: string) {
  const token =
    randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  await cmd(user, { type: 'link_set', basketId, id: randomUUID(), token });
  return token;
}
async function kit(user: string, texts = ['Milk', 'Bread']) {
  const id = randomUUID();
  await cmd(user, {
    type: 'kit_save',
    id,
    title: 'Staples',
    items: texts.map((text) => ({ id: randomUUID(), text })),
  });
  return id;
}

describe('Basket checked database API', () => {
  it('ignores foreign basket IDs attached to non-basket commands', async () => {
    const owner = await person(),
      attacker = await person(),
      id = await basket(owner);
    const before = (await read(owner, id)).basket?.revision;
    await cmd(attacker, {
      type: 'kit_save',
      basketId: id,
      id: randomUUID(),
      title: 'Private',
      items: [{ id: randomUUID(), text: 'Only mine' }],
    });
    await cmd(attacker, {
      type: 'handover_prepare',
      basketId: id,
      token: 'e'.repeat(64),
    });
    expect((await read(owner, id)).basket?.revision).toBe(before);
    expect(
      await asIdentity(
        db,
        attacker,
        'select count(*)::integer as value from public.basket_signals',
      ),
    ).toBe(0);
  });
  it('guests create and share; names and IDs do not grant access', async () => {
    const owner = await person(),
      member = await person(),
      stranger = await person();
    const id = await basket(owner),
      token = await share(owner, id);
    await expect(read(stranger, id)).rejects.toThrow(/available/);
    await cmd(member, { type: 'join', token, name: 'Alex' });
    await cmd(member, { type: 'join', token, name: 'Alex' });
    const state = (await read(member, id)).basket;
    expect(state?.role).toBe('member');
    expect(state?.members).toHaveLength(2);
    await expect(
      cmd(member, { type: 'reset', basketId: id, revision: state?.revision }),
    ).rejects.toThrow(/access/);
    await expect(
      cmd(null, { type: 'create', id: randomUUID(), title: 'No', name: 'No' }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asIdentity(db, stranger, 'select id as value from bk.baskets'),
    ).rejects.toThrow(/permission denied/);
    expect(
      await asIdentity(
        db,
        stranger,
        'select count(*)::integer as value from public.basket_signals',
      ),
    ).toBe(0);
    expect(
      await asIdentity(
        db,
        member,
        'select count(*)::integer as value from public.basket_signals',
      ),
    ).toBe(1);
  });

  it('personal kits stay private and foreign item IDs cannot move between kits', async () => {
    const a = await person(),
      b = await person(),
      k = await kit(a);
    expect((await read(b)).kits).toEqual([]);
    const original = (await read(a)).kits[0];
    await expect(
      cmd(b, { type: 'kit_delete', id: k, revision: 1 }),
    ).rejects.toThrow(/access/);
    await expect(
      cmd(b, {
        type: 'kit_save',
        id: randomUUID(),
        title: 'Stolen',
        items: original.items,
      }),
    ).rejects.toThrow(/another kit/);
    await expect(
      cmd(a, {
        type: 'kit_save',
        id: k,
        title: 'No revision',
        items: original.items,
      }),
    ).rejects.toThrow(/changed/);
  });

  it('multiple independent saved kits reset atomically; stale previews fail', async () => {
    const owner = await person(),
      id = await basket(owner);
    const k1 = await kit(owner),
      k2 = await kit(owner, ['Toothbrush']);
    await cmd(owner, {
      type: 'kit_attach',
      basketId: id,
      id: randomUUID(),
      kitId: k1,
    });
    await cmd(owner, {
      type: 'kit_attach',
      basketId: id,
      id: randomUUID(),
      kitId: k2,
    });
    await expect(
      cmd(owner, {
        type: 'kit_attach',
        basketId: id,
        id: randomUUID(),
        kitId: k1,
      }),
    ).rejects.toThrow(/already saved/);
    const before = (await read(owner, id)).basket;
    expect(before?.items).toHaveLength(3);
    const first = before?.items[0];
    await cmd(owner, {
      type: 'item_edit',
      basketId: id,
      id: first?.id,
      text: 'Oat milk',
      revision: first?.revision,
    });
    await cmd(owner, {
      type: 'item_add',
      basketId: id,
      id: randomUUID(),
      text: 'Birthday candles',
    });
    await expect(
      cmd(owner, { type: 'reset', basketId: id, revision: before?.revision }),
    ).rejects.toThrow(/changed/);
    await expect(cmd(owner, { type: 'reset', basketId: id })).rejects.toThrow(
      /changed/,
    );
    await cmd(owner, { type: 'kit_delete', id: k1, revision: 1 });
    const current = (await read(owner, id)).basket;
    const request = randomUUID(),
      action = { type: 'reset', basketId: id, revision: current?.revision };
    await cmd(owner, action, request);
    await cmd(owner, action, request);
    const reset = (await read(owner, id)).basket;
    expect(reset?.items.map((i) => i.text).sort()).toEqual([
      'Bread',
      'Milk',
      'Toothbrush',
    ]);
    expect(reset?.items.every((i) => !i.completed)).toBe(true);
    expect(reset?.savedKits).toHaveLength(2);
    expect(reset?.members).toHaveLength(1);
    await expect(
      cmd(owner, {
        type: 'item_edit',
        basketId: id,
        id: first?.id,
        revision: 1,
        text: 'Old edit',
      }),
    ).rejects.toThrow(/removed/);
  });

  it('completion sets desired state, unrelated edits survive, and stale edits conflict', async () => {
    const owner = await person(),
      id = await basket(owner),
      one = randomUUID(),
      two = randomUUID();
    await cmd(owner, { type: 'item_add', basketId: id, id: one, text: 'One' });
    await cmd(owner, { type: 'item_add', basketId: id, id: two, text: 'Two' });
    await cmd(owner, {
      type: 'item_check',
      basketId: id,
      id: one,
      completed: true,
    });
    await cmd(owner, {
      type: 'item_check',
      basketId: id,
      id: one,
      completed: true,
    });
    await cmd(owner, {
      type: 'item_edit',
      basketId: id,
      id: two,
      revision: 1,
      text: 'Second',
    });
    expect(
      (await read(owner, id)).basket?.items.map((i) => [i.text, i.completed]),
    ).toEqual([
      ['One', true],
      ['Second', false],
    ]);
    await expect(
      cmd(owner, {
        type: 'item_edit',
        basketId: id,
        id: two,
        revision: 1,
        text: 'Stale',
      }),
    ).rejects.toThrow(/changed/);
    await expect(
      cmd(owner, { type: 'item_check', basketId: id, id: one }),
    ).rejects.toThrow(/state/);
  });

  it('promotion, demotion, removal, and revoked links use current membership', async () => {
    const owner = await person(),
      member = await person(),
      outsider = await person(),
      id = await basket(owner);
    const token = await share(owner, id);
    await cmd(member, { type: 'join', token, name: 'Sam' });
    let state = (await read(owner, id)).basket;
    await cmd(owner, {
      type: 'person',
      basketId: id,
      id: member,
      role: 'owner',
      revision: state?.revision,
    });
    expect((await read(member, id)).basket?.role).toBe('owner');
    state = (await read(member, id)).basket;
    await cmd(member, {
      type: 'person',
      basketId: id,
      id: owner,
      role: 'member',
      revision: state?.revision,
    });
    state = (await read(owner, id)).basket;
    await expect(
      cmd(owner, {
        type: 'person',
        basketId: id,
        id: member,
        role: 'member',
        revision: state?.revision,
      }),
    ).rejects.toThrow(/access/);
    await expect(
      cmd(outsider, { type: 'join', token, name: 'Pat' }),
    ).rejects.toThrow(/not available/);
    state = (await read(member, id)).basket;
    await cmd(member, {
      type: 'person',
      basketId: id,
      id: owner,
      role: 'removed',
      revision: state?.revision,
    });
    await expect(read(owner, id)).rejects.toThrow(/available/);
    await expect(cmd(member, { type: 'leave', basketId: id })).rejects.toThrow(
      /archive/,
    );
    expect(
      (await read(member, id)).basket?.members.filter(
        (m) => m.role === 'owner',
      ),
    ).toHaveLength(1);
  });

  it('archiving blocks edits and joining, and a sole owner can restore', async () => {
    const owner = await person(),
      friend = await person(),
      id = await basket(owner),
      token = await share(owner, id);
    let state = (await read(owner, id)).basket;
    await cmd(owner, {
      type: 'archive',
      basketId: id,
      revision: state?.revision,
      archived: true,
    });
    await expect(
      cmd(friend, { type: 'join', token, name: 'Friend' }),
    ).rejects.toThrow(/not available/);
    await expect(
      cmd(owner, {
        type: 'item_add',
        basketId: id,
        id: randomUUID(),
        text: 'No',
      }),
    ).rejects.toThrow(/Restore/);
    state = (await read(owner, id)).basket;
    await cmd(owner, {
      type: 'archive',
      basketId: id,
      revision: state?.revision,
      archived: false,
    });
    expect((await read(owner, id)).basket?.archived).toBe(false);
  });

  it('a verified account claims guest state once and retires the source session', async () => {
    const guest = await person(),
      account = await person(false),
      attacker = await person(),
      id = await basket(guest),
      k = await kit(guest);
    const link = await share(guest, id);
    await cmd(account, { type: 'join', token: link, name: 'Account' });
    const token = 'b'.repeat(64);
    await cmd(guest, { type: 'handover_prepare', token });
    await expect(
      cmd(attacker, { type: 'handover_finish', token }),
    ).rejects.toThrow(/Verify/);
    await expect(
      cmd(account, { type: 'handover_finish', token: 'c'.repeat(64) }),
    ).rejects.toThrow(/expired/);
    await cmd(account, { type: 'handover_finish', token });
    const state = await read(account, id);
    expect(state.basket?.role).toBe('owner');
    expect(state.basket?.members).toHaveLength(1);
    expect(state.kits[0].id).toBe(k);
    await expect(read(guest, id)).rejects.toThrow(/session/);
    await expect(
      cmd(guest, {
        type: 'create',
        id: randomUUID(),
        title: 'No',
        name: 'Guest',
      }),
    ).rejects.toThrow(/session/);
    await expect(
      cmd(account, { type: 'handover_finish', token }),
    ).rejects.toThrow(/expired/);
  });

  it('new account verification retains the same identity and existing data', async () => {
    const user = await person(),
      id = await basket(user);
    await kit(user);
    await db.query(
      'update auth.users set is_anonymous=false,email_confirmed_at=now(),email=$2 where id=$1',
      [user, 'new@example.invalid'],
    );
    const state = await read(user, id);
    expect(state.userId).toBe(user);
    expect(state.basket?.role).toBe('owner');
    expect(state.kits).toHaveLength(1);
  });

  it('a handover cannot claim a guest that has since become a permanent account', async () => {
    const guest = await person(),
      target = await person(false),
      id = await basket(guest),
      token = 'f'.repeat(64);
    await cmd(guest, { type: 'handover_prepare', token });
    await db.query(
      'update auth.users set is_anonymous=false,email_confirmed_at=now() where id=$1',
      [guest],
    );
    await expect(
      cmd(target, { type: 'handover_finish', token }),
    ).rejects.toThrow(/already become an account/);
    expect((await read(guest, id)).basket?.role).toBe('owner');
    await expect(read(target, id)).rejects.toThrow(/available/);
  });

  it('idempotency rejects reused request IDs with different content', async () => {
    const user = await person(),
      request = randomUUID(),
      id = randomUUID();
    await cmd(
      user,
      { type: 'create', id, title: 'First', name: 'Alex' },
      request,
    );
    await expect(
      cmd(user, { type: 'create', id, title: 'Second', name: 'Alex' }, request),
    ).rejects.toThrow(/already used/);
    expect((await read(user, id)).basket?.title).toBe('First');
  });
});
