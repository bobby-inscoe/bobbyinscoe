import { expect, test } from '@playwright/test';

test('demo previews onboarding and the app without contacting the account backend', async ({
  page,
  context,
}) => {
  const backendRequests: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.hostname.includes('supabase') ||
      url.pathname.includes('/auth/v1/') ||
      url.pathname.includes('/rest/v1/') ||
      url.pathname.includes('/functions/v1/')
    )
      backendRequests.push(url.href);
    if (['localhost', '127.0.0.1'].includes(url.hostname))
      await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.goto('/shellter?demo=create');
  const choose = async (name: string) => {
    await page
      .getByRole('combobox', { name: 'Demo screen', exact: true })
      .click();
    await page.getByRole('option', { name, exact: true }).click();
  };
  await expect(
    page.getByRole('heading', { name: 'Create your own household' }),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Already have an account? Sign in',
      exact: true,
    })
    .click();
  await expect(page.getByLabel('Remember this device')).toBeVisible();
  await page
    .getByRole('button', {
      name: 'New to Shellter? Create an account',
      exact: true,
    })
    .click();
  // Empty credentials are intentional: these are the real forms with simulated actions.
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Household name', exact: true })
    .fill('Demo nest');
  await page
    .getByRole('textbox', { name: 'Your name', exact: true })
    .fill('Preview person');
  await page
    .getByRole('button', { name: 'Hide demo controls', exact: true })
    .click();
  await expect(
    page.getByRole('combobox', { name: 'Demo screen', exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole('textbox', { name: 'Your name', exact: true }),
  ).toHaveValue('Preview person');
  await page
    .getByRole('button', { name: 'Show demo controls', exact: true })
    .click();
  await expect(
    page.getByRole('combobox', { name: 'Demo screen', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Your name', exact: true }),
  ).toHaveValue('Preview person');
  await page
    .getByRole('button', { name: 'Create household', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Keep starter criteria', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Keep starter criteria', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Keep starter criteria', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Invite someone', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Restart screen', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Create account', exact: true }),
  ).toBeVisible();

  await choose('Signed out');
  await page
    .getByRole('button', { name: 'Forgot password?', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Send reset link', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'If an account uses that address',
  );
  await page
    .getByRole('button', { name: 'Back to sign in', exact: true })
    .click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Favorites', exact: true }),
  ).toBeVisible();

  await choose('Invitation: join a household');
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Your name', exact: true })
    .fill('Demo joiner');
  await page
    .getByRole('button', { name: 'Join household', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Favorites', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Keep starter criteria', exact: true }),
  ).toHaveCount(0);

  await choose('Set a new password');
  await expect(
    page.getByRole('heading', { name: 'Choose a new password', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Save password', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Favorites', exact: true }),
  ).toBeVisible();
  await choose('Account without a household');
  await expect(
    page.getByRole('alert').filter({ hasText: 'no active household' }),
  ).toBeVisible();
  await choose('New household setup');
  await expect(
    page.getByRole('button', { name: 'Keep starter criteria', exact: true }),
  ).toBeVisible();
  await choose('Existing household');
  await expect(
    page.getByRole('button', { name: 'Favorites', exact: true }),
  ).toBeVisible();
  expect(backendRequests).toEqual([]);
});
