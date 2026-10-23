import { expect, type Page, test } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context }) => {
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
  await select.selectOption(next);
}

test('Swedish is the default and an explicit English choice survives reload', async ({
  page,
}) => {
  await page.goto('/shellter');
  await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  await expect(
    page.getByRole('combobox', { name: 'Språk', exact: true }),
  ).toHaveValue('sv');
  await chooseLanguage(page, 'sv', 'en');
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'Language', exact: true }),
  ).toHaveValue('en');
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await expect(
    page.getByRole('combobox', { name: 'Language', exact: true }),
  ).toHaveCount(0);
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

test('member menu stays beside the name on mobile and desktop in both languages', async ({
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
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const language of ['sv', 'en'] as const) {
      if (language === 'en') await chooseLanguage(page, 'sv', 'en');
      const row = page.getByRole('listitem').filter({ hasText: 'Demo Morgan' });
      const name = row.getByText('Demo Morgan', { exact: true });
      const trigger = row.getByRole('button', {
        name:
          language === 'sv'
            ? 'Åtgärder för Demo Morgan'
            : 'Actions for Demo Morgan',
        exact: true,
      });
      await expect(trigger).toBeVisible();
      const nameBox = await name.boundingBox();
      const triggerBox = await trigger.boundingBox();
      if (!nameBox || !triggerBox) throw new Error('Member row is missing');
      expect(
        Math.abs(
          nameBox.y + nameBox.height / 2 - triggerBox.y - triggerBox.height / 2,
        ),
      ).toBeLessThan(1);
      expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(triggerBox.x);
      expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(width);
      const select = page.getByRole('combobox', {
        name: language === 'sv' ? 'Språk' : 'Language',
        exact: true,
      });
      const selectWidth = await select.evaluate(
        (element) => element.getBoundingClientRect().width,
      );
      if (width < 576) {
        const contentWidth = await select.evaluate((element) => {
          const paper = element.closest('.mantine-Paper-root');
          if (!paper) throw new Error('Missing personal settings panel');
          const style = getComputedStyle(paper);
          return (
            paper.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight)
          );
        });
        expect(Math.abs(selectWidth - contentWidth)).toBeLessThan(2);
      } else expect(selectWidth).toBe(240);
      await trigger.click();
      await expect(
        page.getByRole('menuitem', {
          name: language === 'sv' ? 'Gör till ägare' : 'Make owner',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('menuitem', {
          name: language === 'sv' ? 'Ta bort' : 'Remove',
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      if (language === 'en') await chooseLanguage(page, 'en', 'sv');
    }
  }
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

test('Sign out follows personal settings and calls the session action', async ({
  page,
}) => {
  await page.route(
    '**/src/features/house-scanner/components/synthetic-workspace.tsx*',
    async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      const marker = 'userId: DEMO_USER_ID,';
      if (!source.includes(marker))
        throw new Error('Demo workspace fixture changed');
      await route.fulfill({
        response,
        body: source.replace(
          marker,
          marker +
            "onSignOut: () => { document.documentElement.dataset.signedOut = 'true'; },",
        ),
      });
    },
  );
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
  const language = page.getByRole('combobox', { name: 'Språk', exact: true });
  expect(
    await language.evaluate((element) => {
      const signOut = Array.from(document.querySelectorAll('button')).find(
        (button) => button.textContent === 'Logga ut',
      );
      return (
        signOut &&
        Boolean(
          element.compareDocumentPosition(signOut) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        )
      );
    }),
  ).toBe(true);
  for (const [name, width] of [
    ['mobile', 390],
    ['desktop', 1000],
  ] as const) {
    await page.setViewportSize({ width, height: 1300 });
    await page
      .getByRole('heading', { name: 'Hushåll', exact: true })
      .evaluate((element) =>
        element.scrollIntoView({ block: 'start', behavior: 'instant' }),
      );
    await page.screenshot({
      path: `.browser-test-results/settings-${name}.png`,
    });
  }
  await signOut.click();
  await expect(page.locator('html')).toHaveAttribute('data-signed-out', 'true');
});

test('map controls use the language selected in settings', async ({ page }) => {
  await page.goto('/shellter');
  await chooseLanguage(page, 'sv', 'en');
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await openSettings(page);
  await chooseLanguage(page, 'en', 'sv');
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
  ).toHaveValue('en');
  await page.reload();
  await expect(
    page.getByRole('combobox', { name: 'Språk', exact: true }),
  ).toHaveValue('sv');
});
