import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (['localhost', '127.0.0.1'].includes(host)) await route.continue();
    else await route.abort('blockedbyclient');
  });
});

for (const action of ['menu', 'drawer'] as const) {
  test(`Viewings ${action} opens the selected home on the map despite old browse filters`, async ({
    page,
  }) => {
    await page.goto('/shellter/viewings?q=does-not-match&minPrice=9000000');
    await page.getByRole('button', { name: 'Demo', exact: true }).click();
    const card = page
      .getByRole('article', { name: /^Example balcony home,/ })
      .first();
    if (action === 'menu') {
      await card
        .getByRole('button', { name: 'More actions for Example balcony home' })
        .click();
      await page
        .getByRole('menuitem', { name: 'See on map', exact: true })
        .click();
    } else {
      await card.getByRole('button', { name: 'Details', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Example balcony home', exact: true })
        .getByRole('button', { name: 'See on map', exact: true })
        .click();
    }
    await expect(page.getByLabel('Listing map')).toBeVisible();
    await expect(
      page.getByRole('article', {
        name: 'Selected home: Example balcony home',
        exact: true,
      }),
    ).toBeVisible();
    const search = new URL(page.url()).searchParams;
    expect(search.has('q')).toBe(false);
    expect(search.has('minPrice')).toBe(false);
    expect(search.get('dupes')).toBe('true');
  });
}

test('a failed hide in the Viewings drawer reports the error inside the drawer and after closing it', async ({
  page,
}) => {
  await page.route(
    '**/src/features/house-scanner/components/synthetic-workspace.tsx*',
    async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      expect(body).toContain('onSetHidden: demo.setHidden');
      await route.fulfill({
        response,
        body: body.replace(
          'onSetHidden: demo.setHidden',
          'onSetHidden: async () => { throw new Error("Simulated offline"); }',
        ),
      });
    },
  );
  await page.goto('/shellter/viewings');
  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await page
    .getByRole('article', { name: /^Example balcony home,/ })
    .first()
    .getByRole('button', { name: 'Details', exact: true })
    .click();
  const drawer = page.getByRole('dialog', {
    name: 'Example balcony home',
    exact: true,
  });
  await drawer
    .getByRole('button', { name: 'Hide this home', exact: true })
    .click();
  await expect(drawer.getByRole('alert')).toContainText(
    'Could not confirm the change',
  );
  await expect(
    drawer.getByRole('button', { name: 'Hide this home', exact: true }),
  ).toBeVisible();
  await drawer.getByRole('button', { name: 'Close listing details' }).click();
  await expect(drawer).not.toBeVisible();
  await expect(
    page
      .getByText('Could not confirm the change', { exact: false })
      .filter({ visible: true }),
  ).toContainText('Could not confirm the change');
});
