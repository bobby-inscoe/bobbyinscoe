import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { expect, type Page, test } from '@playwright/test';
import { browserBackend } from '../../../../tools/basket-backend/browser-backend';
import {
  addIdentity,
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
  await page
    .getByRole('textbox', { name: 'Item 1', exact: true })
    .fill('Toothbrush');
  await page
    .getByRole('button', { name: 'Add another item', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Item 2', exact: true })
    .fill('Socks');
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
  await page
    .getByRole('button', { name: 'Actions for Toothbrush', exact: true })
    .click();
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
  await action(page, 'Reset to saved kits');
  await expect(
    page.getByRole('dialog', { name: 'Reset to saved kits?' }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Keep current list', exact: true })
    .click();
  await expect(
    page.getByRole('checkbox', { name: 'Birthday candles', exact: true }),
  ).toBeVisible();
  await action(page, 'Reset to saved kits');
  await page.getByRole('button', { name: 'Reset basket', exact: true }).click();
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
  await page.getByRole('button', { name: 'Share basket', exact: true }).click();
  await page
    .getByRole('button', { name: 'Create a join link', exact: true })
    .click();
  const link = await page
    .getByRole('textbox', { name: 'Join link', exact: true })
    .inputValue();
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
    await action(friend, 'Basket settings');
    await expect(
      friend.getByRole('button', { name: 'Leave basket', exact: true }),
    ).toBeVisible();
    await expect(
      friend.getByRole('button', { name: 'Disable join link', exact: true }),
    ).toHaveCount(0);
    await closePanel(friend);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
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
