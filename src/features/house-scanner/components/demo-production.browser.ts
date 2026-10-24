import { expect, test } from '@playwright/test';

test('production ignores demo links and exposes no demo controls or fictional household', async ({
  page,
}) => {
  test.skip(
    !process.env.HOUSE_SCANNER_BROWSER_URL,
    'Requires a production preview',
  );
  for (const purpose of ['create', 'join']) {
    await page.goto(`/shellter?demo=${purpose}`);
    await expect(
      page.getByRole('heading', { name: 'Shellter', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /demo/i })).toHaveCount(0);
    await expect(
      page.getByRole('combobox', { name: 'Demo screen', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Create your own household' }),
    ).toHaveCount(0);
  }
});
