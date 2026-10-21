import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { expect, type Page, test } from '@playwright/test';
import { browserBackend } from '../../../../tools/basket-backend/browser-backend';
import {
  addIdentity,
  asIdentity,
  createDatabase,
} from '../../../../tools/basket-backend/test-database';

let db: PGlite;
let attach: ReturnType<typeof browserBackend>;
test.beforeEach(async ({ context }) => {
  db = await createDatabase();
  attach = browserBackend(db);
  await attach(context);
});
test.afterEach(async () => {
  await db.close();
});

async function create(page: Page, title = 'Weekend away') {
  await page.goto('/basket');
  await page
    .getByRole('button', { name: 'Create a basket', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Basket name', exact: true })
    .fill(title);
  await page
    .getByRole('textbox', { name: 'Your name', exact: true })
    .fill('Alex');
  await page
    .getByRole('button', { name: 'Create basket', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
}
async function action(page: Page, name: string) {
  await page
    .getByRole('button', { name: 'Basket actions', exact: true })
    .click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
async function closePanel(page: Page) {
  await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function add(page: Page, text: string) {
  await page
    .getByRole('textbox', { name: 'Add an item', exact: true })
    .fill(text);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: text, exact: true }),
  ).toBeVisible();
}

test('phone-first kits, reset confirmation, archive, and keyboard controls', async ({
  page,
}) => {
  await create(page);
  await add(page, 'Birthday candles');
  await page
    .getByRole('navigation', { name: 'Basket navigation' })
    .getByRole('button', { name: 'Kits', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Create your first kit', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Kit name', exact: true })
    .fill('Packing essentials');
  await page.getByRole('button', { name: 'Save kit', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Add at least one item to this kit.',
  );
  const first = page.getByRole('textbox', { name: 'Item 1', exact: true });
  await first.fill('Toothbrush');
  await first.press('Enter');
  const second = page.getByRole('textbox', { name: 'Item 2', exact: true });
  await expect(second).toBeFocused();
  await second.fill('Socks');
  await second.press('Enter');
  const blank = page.getByRole('textbox', { name: 'Item 3', exact: true });
  await expect(blank).toBeFocused();
  await blank.fill('   ');
  await page.getByRole('button', { name: 'Save kit', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('navigation', { name: 'Basket navigation' })
    .getByRole('button', { name: 'Baskets', exact: true })
    .click();
  await page.getByRole('button', { name: /Weekend away/ }).click();
  await action(page, 'Saved kits');
  await page.getByRole('button', { name: 'Add kit', exact: true }).click();
  await expect(
    page.getByText('Kit saved and its items added.', { exact: true }),
  ).toBeVisible();
  await closePanel(page);
  await page.getByRole('checkbox', { name: 'Socks', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('checkbox', { name: 'Socks', exact: true }),
  ).toBeChecked();
  const toothbrush = page.getByRole('checkbox', {
    name: 'Toothbrush',
    exact: true,
  });
  const bounds = await toothbrush.boundingBox();
  if (!bounds) throw new Error('Checklist row is not visible.');
  expect(bounds.width).toBeGreaterThan(150);
  expect(bounds.height).toBeGreaterThanOrEqual(72);
  await toothbrush.click({ position: { x: bounds.width - 4, y: 4 } });
  await expect(toothbrush).toBeChecked();
  await expect(toothbrush).toBeEnabled();
  await toothbrush.click({
    position: { x: bounds.width - 4, y: bounds.height - 4 },
  });
  await expect(toothbrush).not.toBeChecked();
  await page
    .getByRole('button', { name: 'Actions for Toothbrush', exact: true })
    .click();
  await expect(toothbrush).not.toBeChecked();
  await page
    .getByRole('menuitem', { name: 'Rename item', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Item name', exact: true })
    .fill('Electric toothbrush');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(
    page.getByText('1 item differs from saved kits.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reset basket', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Reset to saved kits?' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Keep current list', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', { name: 'Birthday candles', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reset basket', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Reset to saved kits?' })
    .getByRole('button', { name: 'Reset basket', exact: true })
    .click();
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(
    page.getByRole('checkbox', { name: 'Toothbrush', exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Socks', exact: true }),
  ).not.toBeChecked();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath('basket-checklist.png'),
    fullPage: true,
  });
  let releaseReset = () => {};
  let resetStarted = () => {};
  const resetGate = new Promise<void>((resolve) => {
    releaseReset = resolve;
  });
  const resetSeen = new Promise<void>((resolve) => {
    resetStarted = resolve;
  });
  await page.route('**/rest/v1/rpc/basket_command', async (route) => {
    if (route.request().postDataJSON().p_action.type === 'reset') {
      resetStarted();
      await resetGate;
    }
    await route.fallback();
  });
  await add(page, 'One-off item');
  await page.getByRole('checkbox', { name: 'Socks', exact: true }).check();
  await page.getByRole('button', { name: 'Reset basket', exact: true }).click();
  await resetSeen;
  try {
    await expect(
      page.getByRole('button', { name: 'Basket actions', exact: true }),
    ).toBeEnabled();
    const plus = page.getByRole('button', { name: 'Add item', exact: true });
    await expect(plus).toBeEnabled();
    await expect(plus).not.toHaveAttribute('data-loading');
    await expect(
      page.getByRole('button', { name: 'Actions for Socks', exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole('checkbox', { name: 'Socks', exact: true }),
    ).toBeEnabled();
    await action(page, 'Basket settings');
  } finally {
    releaseReset();
  }
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(
    page.getByRole('dialog', { name: 'Basket settings', exact: true }),
  ).toBeVisible();
  await closePanel(page);
  await expect(
    page.getByRole('checkbox', { name: 'Socks', exact: true }),
  ).not.toBeChecked();
  await action(page, 'Archive basket');
  await expect(page.getByText('Taking a break', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await action(page, 'Restore basket');
  await expect(
    page.getByRole('textbox', { name: 'Add an item', exact: true }),
  ).toBeVisible();
});

test('two guest browsers share a basket and receive periodic updates without reloading', async ({
  page,
  browser,
}) => {
  await create(page, 'Groceries');
  await add(page, 'Milk');
  const membership = (
    await db.query<{ user_id: string; basket_id: string }>(
      'select user_id, basket_id from bk.members',
    )
  ).rows[0];
  const kitId = randomUUID();
  for (const command of [
    {
      type: 'kit_save',
      id: kitId,
      title: 'Grocery staples',
      items: [{ id: randomUUID(), text: 'Bread' }],
    },
    {
      type: 'kit_attach',
      basketId: membership.basket_id,
      id: randomUUID(),
      kitId,
    },
  ])
    await asIdentity(
      db,
      membership.user_id,
      'select public.basket_command($1,$2) as value',
      [randomUUID(), command],
    );
  await page.reload();
  await page.getByRole('button', { name: 'Share basket', exact: true }).click();
  await page
    .getByRole('button', { name: 'Create a join link', exact: true })
    .click();
  const link = await page
    .getByRole('textbox', { name: 'Join link', exact: true })
    .inputValue();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) =>
          sessionStorage.setItem('basket.test.copied', value),
      },
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        throw new Error('Copy must not open the share sheet.');
      },
    });
  });
  await page.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(
    page.getByText('Join link copied.', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem('basket.test.copied')),
  ).toBe(link);
  await closePanel(page);
  const friendContext = await browser.newContext({
    baseURL: 'http://localhost:5191',
    viewport: { width: 390, height: 844 },
  });
  await attach(friendContext);
  const friend = await friendContext.newPage();
  try {
    await friend.goto(link);
    await friend
      .getByRole('textbox', { name: 'Your name', exact: true })
      .fill('Sam');
    await friend
      .getByRole('button', { name: 'Join basket', exact: true })
      .click();
    await expect(
      friend.getByRole('heading', { name: 'Groceries', exact: true }),
    ).toBeVisible();
    await friend.getByRole('checkbox', { name: 'Milk', exact: true }).check();
    await expect(
      page.getByRole('checkbox', { name: 'Milk', exact: true }),
    ).toBeChecked({ timeout: 22000 });
    await expect(
      friend.getByRole('button', { name: 'Reset basket', exact: true }),
    ).toHaveCount(0);
    await action(friend, 'Basket settings');
    await expect(
      friend.getByRole('button', { name: 'Leave basket', exact: true }),
    ).toBeVisible();
    await expect(
      friend.getByRole('button', { name: 'Disable join link', exact: true }),
    ).toHaveCount(0);
    await closePanel(friend);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page
      .getByRole('button', { name: 'Reset basket', exact: true })
      .click();
    await expect(
      page.getByRole('dialog', { name: 'Reset to saved kits?' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Keep current list', exact: true })
      .click();
    await action(page, 'Archive basket');
    await expect(
      page.getByRole('dialog', { name: 'Archive for everyone?' }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Archive basket', exact: true })
      .click();
    await friend.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      friend.getByText('Taking a break', { exact: true }),
    ).toBeVisible();
    await expect(
      friend.getByRole('checkbox', { name: 'Milk', exact: true }),
    ).toBeDisabled();
  } finally {
    await friendContext.close();
  }
});

test('slow saves keep controls steady and preserve rapid checkbox changes and additions', async ({
  page,
}) => {
  await create(page);
  await add(page, 'First item');
  await add(page, 'Second item');
  let release = () => {};
  let started = () => {};
  let blocked = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/rest/v1/rpc/basket_command', async (route) => {
    if (
      !blocked &&
      route.request().postDataJSON().p_action.type === 'item_check'
    ) {
      blocked = true;
      started();
      await gate;
    }
    await route.fallback();
  });
  const first = page.getByRole('checkbox', { name: 'First item', exact: true });
  const second = page.getByRole('checkbox', {
    name: 'Second item',
    exact: true,
  });
  await first.check();
  await seen;
  try {
    await expect(
      page.getByRole('button', { name: 'Basket actions', exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole('button', { name: 'Actions for First item', exact: true }),
    ).toBeEnabled();
    await first.uncheck();
    await second.check();
    await expect(first).not.toBeChecked();
    await expect(second).toBeChecked();
    const plus = page.getByRole('button', { name: 'Add item', exact: true });
    await expect(plus).toBeEnabled();
    await expect(plus).not.toHaveAttribute('data-loading');
    await page
      .getByRole('textbox', { name: 'Add an item', exact: true })
      .fill('Third item');
    await plus.click();
  } finally {
    release();
  }
  await expect(
    page.getByRole('checkbox', { name: 'Third item', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(first).not.toBeChecked();
  await expect(second).toBeChecked();
  await expect(page.getByRole('checkbox')).toHaveCount(3);
});

test('display name survives new baskets and reloads, with membership fallback for older sessions', async ({
  page,
}) => {
  await create(page, 'First basket');
  await page.goto('/basket');
  await page
    .getByRole('button', { name: 'Create a basket', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Your name', exact: true }),
  ).toHaveValue('Alex');
  await page
    .getByRole('textbox', { name: 'Your name', exact: true })
    .fill('Sam');
  await page
    .getByRole('textbox', { name: 'Basket name', exact: true })
    .fill('Second basket');
  await page
    .getByRole('button', { name: 'Create basket', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Second basket', exact: true }),
  ).toBeVisible();
  await page.goto('/basket');
  await page
    .getByRole('button', { name: 'Create a basket', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Your name', exact: true }),
  ).toHaveValue('Sam');
  await closePanel(page);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith('basket.name.')) localStorage.removeItem(key);
  });
  await page.reload();
  await page
    .getByRole('button', { name: 'Create a basket', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Your name', exact: true }),
  ).toHaveValue('Sam');
});

test('new account verification preserves guest ownership and kits', async ({
  page,
}) => {
  await create(page);
  const id = (
    await db.query<{ user_id: string }>('select user_id from bk.members')
  ).rows[0].user_id;
  await page.getByRole('button', { name: 'Your access', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Email address', exact: true })
    .fill('alex@example.invalid');
  await page
    .getByRole('button', { name: 'Send verification code', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Email code', exact: true })
    .fill('123456');
  await page
    .getByRole('button', { name: 'Verify and keep my access', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    (
      await db.query<{ user_id: string }>(
        'select user_id from bk.members where active',
      )
    ).rows[0].user_id,
  ).toBe(id);
  expect(
    (
      await db.query<{ is_anonymous: boolean }>(
        'select is_anonymous from auth.users where id=$1',
        [id],
      )
    ).rows[0].is_anonymous,
  ).toBe(false);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Weekend away', exact: true }),
  ).toBeVisible();
});

test('existing-account sign-in retains guest baskets and retires the guest session', async ({
  page,
}) => {
  const account = randomUUID();
  await addIdentity(db, account, false);
  await db.query('update auth.users set email=$2 where id=$1', [
    account,
    'existing@example.invalid',
  ]);
  await create(page);
  const guest = (
    await db.query<{ user_id: string }>('select user_id from bk.members')
  ).rows[0].user_id;
  await page.getByRole('button', { name: 'Your access', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Sign in to an existing account',
      exact: true,
    })
    .click();
  await page
    .getByRole('textbox', { name: 'Email address', exact: true })
    .fill('existing@example.invalid');
  await page
    .getByRole('button', { name: 'Send sign-in code', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Email code', exact: true })
    .fill('123456');
  await page
    .getByRole('button', { name: 'Verify and keep my access', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(
    (
      await db.query<{ user_id: string }>(
        'select user_id from bk.members where active',
      )
    ).rows[0].user_id,
  ).toBe(account);
  expect(
    (
      await db.query<{ user_id: string }>(
        'select user_id from bk.retired_identities',
      )
    ).rows[0].user_id,
  ).toBe(guest);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Weekend away', exact: true }),
  ).toBeVisible();
});

test('sign-in recovers after a committed handover response is lost and the page reloads', async ({
  page,
  context,
}) => {
  const account = randomUUID();
  await addIdentity(db, account, false);
  await db.query('update auth.users set email=$2 where id=$1', [
    account,
    'recover@example.invalid',
  ]);
  await context.unroute('http://127.0.0.1:54331/**');
  await browserBackend(db, { loseHandoverResponse: true })(context);
  await create(page);
  async function signIn() {
    await page
      .getByRole('button', { name: 'Your access', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: 'Sign in to an existing account',
        exact: true,
      })
      .click();
    await page
      .getByRole('textbox', { name: 'Email address', exact: true })
      .fill('recover@example.invalid');
    await page
      .getByRole('button', { name: 'Send sign-in code', exact: true })
      .click();
    await page
      .getByRole('textbox', { name: 'Email code', exact: true })
      .fill('123456');
    await page
      .getByRole('button', { name: 'Verify and keep my access', exact: true })
      .click();
  }
  await signIn();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(
    (
      await db.query<{ user_id: string }>(
        'select user_id from bk.members where active',
      )
    ).rows[0].user_id,
  ).toBe(account);
  await page.reload();
  await signIn();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Weekend away', exact: true }),
  ).toBeVisible();
});
