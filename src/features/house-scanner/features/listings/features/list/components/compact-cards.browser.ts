import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1'].includes(url.hostname))
      await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.goto('/shellter');
  await page
    .getByRole('button', { name: 'Explore the synthetic demo' })
    .click();
  await expect(page.getByRole('article').first()).toBeVisible();
});

test('title and thumbnail open internal details with explicit source access', async ({
  page,
}) => {
  const card = page.getByRole('article', {
    name: 'Example balcony home',
    exact: true,
  });
  await card.getByRole('button', { name: 'View Example balcony home' }).click();
  const details = page.getByRole('dialog');
  await expect(details).toBeVisible();
  await expect(
    details.getByRole('link', { name: 'Open original listing' }),
  ).toHaveAttribute('target', '_blank');
  await expect(details.getByText('Saved by Demo Morgan')).toBeVisible();
  await page.goBack();
  await expect(details).not.toBeVisible();
  await card
    .getByRole('button', { name: 'Example balcony home', exact: true })
    .click();
  await expect(details).toBeVisible();
  await details.getByRole('button', { name: 'Close listing details' }).click();
  await expect(details).not.toBeVisible();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await card
    .getByRole('button', { name: 'Example balcony home', exact: true })
    .click();
  await details.getByRole('button', { name: 'Close listing details' }).click();
  await expect(details).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Favorites', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('mobile summaries keep individual actions reachable', async ({ page }) => {
  test.skip(test.info().project.name !== 'narrow', 'Mobile result density');
  await page.setViewportSize({ width: 390, height: 844 });
  const cards = page.getByRole('article');
  const first = cards.first();
  await expect(first).toBeVisible();
  await expect(
    first.getByText('Saved by Demo Morgan', { exact: true }),
  ).not.toBeVisible();
  await first.getByRole('button', { name: /More actions/ }).click();
  await expect(
    page.getByRole('menuitem', { name: 'Share this listing' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  for (const name of ['Details', 'Save favorite', 'Hide this home']) {
    const target = await first
      .getByRole('button', { name, exact: true })
      .boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
  }
});

test('narrow summaries retain facts and controls at large text size', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'narrow', 'Mobile text scaling');
  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const card = page.getByRole('article', {
    name: 'Example balcony home',
    exact: true,
  });
  await expect(
    card.getByRole('button', { name: 'Example balcony home', exact: true }),
  ).toBeVisible();
  await expect(card.getByRole('button', { name: 'Details' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const selectionLabel = await card
    .getByRole('checkbox', { name: 'Select Example balcony home', exact: true })
    .boundingBox();
  const favorite = await card
    .getByRole('button', { name: 'Save favorite', exact: true })
    .boundingBox();
  expect(selectionLabel).not.toBeNull();
  expect(favorite).not.toBeNull();
  if (!selectionLabel || !favorite)
    throw new Error('Missing selection or favorite control.');
  expect(
    favorite.x >= selectionLabel.x + selectionLabel.width ||
      selectionLabel.x >= favorite.x + favorite.width ||
      favorite.y >= selectionLabel.y + selectionLabel.height ||
      selectionLabel.y >= favorite.y + favorite.height,
  ).toBe(true);
});
