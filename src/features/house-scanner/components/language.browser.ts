import { expect, type Page, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context, page }) => {
  // The dev-only demo controls push the app down on a phone; tests use the app itself.
  await page.addLocatorHandler(page.locator('#shellter-demo-controls'), () =>
    page
      .getByRole('button', {
        name: /^(Hide demo controls|Dölj demokontroller)$/,
      })
      .click(),
  );
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(url.hostname))
      await route.continue();
    else if (url.href === 'https://tiles.openfreemap.org/styles/liberty')
      await route.fulfill({ json: { version: 8, sources: {}, layers: [] } });
    else await route.abort('blockedbyclient');
  });
});

async function openSettings(page: Page, swedish = false) {
  await page
    .getByRole('button', { name: swedish ? 'Mer' : 'More', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: swedish ? /^Inställningar/ : /^Settings/ })
    .click();
  await expect(
    page.getByRole('menuitem', {
      name: swedish ? /^Inställningar/ : /^Settings/,
    }),
  ).toBeHidden();
}

async function chooseLanguage(
  page: Page,
  current: 'en' | 'sv',
  next: 'en' | 'sv',
) {
  const select = page.getByRole('combobox', {
    name: current === 'sv' ? 'Språk' : 'Language',
    exact: true,
  });
  await select.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await select.click();
  await page
    .getByRole('option', {
      name: next === 'sv' ? 'Svenska' : 'English',
      exact: true,
    })
    .click();
}

test('Swedish is the default and an explicit English choice survives reload', async ({
  page,
}) => {
  await page.goto('/shellter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  await expect(
    page.getByRole('combobox', { name: 'Språk', exact: true }),
  ).toHaveValue('Svenska');
  await chooseLanguage(page, 'sv', 'en');
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'Language', exact: true }),
  ).toHaveValue('English');
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await expect(
    page.getByRole('combobox', { name: 'Language', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Language', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await openSettings(page);
  const personal = page.getByRole('heading', {
    name: 'Personal settings',
    exact: true,
  });
  await expect(personal).toBeVisible();
  const headings = await page
    .getByRole('heading', { level: 2 })
    .allTextContents();
  expect(headings.indexOf('Personal settings')).toBeGreaterThan(
    headings.indexOf('Household'),
  );
  await page
    .getByRole('textbox', { name: 'Maximum budget (SEK)' })
    .fill('3600000');
  await chooseLanguage(page, 'en', 'sv');
  await expect(
    page.getByRole('textbox', { name: 'Maxbudget (SEK)' }),
  ).toHaveValue('3 600 000');
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  expect(
    await page.evaluate(() => localStorage.getItem('shellter.language')),
  ).toBe('sv');
});

test('the member menu makes an owner and removes a member after confirmation', async ({
  page,
}) => {
  await page.goto('/shellter');
  await page
    .getByRole('button', {
      name: 'Utforska demon med fiktiva uppgifter',
      exact: true,
    })
    .click();
  await openSettings(page, true);
  const trigger = page.getByRole('button', {
    name: 'Åtgärder för Demo Morgan',
    exact: true,
  });
  await trigger.click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('menuitem', { name: 'Ta bort', exact: true }).click();
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('menuitem', { name: 'Gör till ägare', exact: true })
    .click();
  await trigger.click();
  await expect(
    page.getByRole('menuitem', { name: 'Gör till ägare', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('menuitem', { name: 'Ta bort', exact: true }),
  ).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('menuitem', { name: 'Ta bort', exact: true }).click();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Demo Morgan' }),
  ).toHaveCount(0);
});

test('Sign out in personal settings ends the session', async ({ page }) => {
  await page.goto('/shellter');
  await page
    .getByRole('button', {
      name: 'Utforska demon med fiktiva uppgifter',
      exact: true,
    })
    .click();
  await openSettings(page, true);
  const signOut = page.getByRole('button', { name: 'Logga ut', exact: true });
  await expect(signOut).toBeVisible();
  await signOut.click();
  await expect(signOut).toHaveCount(0);
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('map controls use the language selected in settings', async ({ page }) => {
  await page.goto('/shellter');
  await chooseLanguage(page, 'sv', 'en');
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await openSettings(page);
  await chooseLanguage(page, 'en', 'sv');
  // The phone navigation recedes while scrolled; scrolling up brings it back.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: 'Bostäder', exact: true }).click();
  await page.getByRole('button', { name: 'Karta', exact: true }).click();
  const map = page.getByLabel('Bostadskarta', { exact: true });
  await expect(map.locator('canvas')).toHaveAttribute('aria-label', 'Karta');
  await expect(map.locator('.maplibregl-ctrl-zoom-in')).toHaveAttribute(
    'aria-label',
    'Zooma in',
  );
  await expect(
    page.getByRole('button', { name: /^2 bostäder i närheten/ }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.getByRole('link', { name: 'Tillbaka till verkstaden' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('blocked preference writes keep the chosen language usable and explain persistence failure', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'shellter.language')
        throw new DOMException('Storage blocked', 'SecurityError');
      return setItem.call(this, key, value);
    };
  });
  await page.goto('/shellter');
  await chooseLanguage(page, 'sv', 'en');
  await expect(page.getByRole('status')).toContainText('could not');
  await expect(
    page.getByRole('combobox', { name: 'Language', exact: true }),
  ).toHaveValue('English');
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'Språk', exact: true }),
  ).toHaveValue('Svenska');
});
