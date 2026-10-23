import { expect, test } from '@playwright/test';

test('retains a failed draft and sends a retry on desktop and mobile', async ({
  page,
}) => {
  page.on('pageerror', (error) => {
    throw error;
  });
  await page.route(
    '**/src/features/house-scanner/api/household-client.ts',
    (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: `export function createHouseholdClient() { return { functions: { invoke: async (_name, options) => { window.feedbackRequests ??= []; window.feedbackRequests.push(options.body); return window.feedbackRequests.length === 1 ? {error: new Error('offline')} : {data: {status: 'sent'}}; } } }; }`,
      }),
  );
  await page.route('**/feedback-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<div id="root"></div><script type="module" src="/src/features/house-scanner/features/feedback/components/feedback-fixture.tsx"></script>`,
    }),
  );
  await page.goto('/feedback-test');
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Save failed');
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('I edited a home and pressed save.');
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not send');
  await page
    .getByRole('button', { name: 'Cancel', exact: true })
    .last()
    .click();
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Title', exact: true }),
  ).toHaveValue('Save failed');
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.getByRole('status')).toContainText('accepted for sending');
  await expect(
    page.getByRole('textbox', { name: 'Title', exact: true }),
  ).toHaveValue('');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => {
      const requests = (
        window as unknown as { feedbackRequests: { id: string }[] }
      ).feedbackRequests;
      return requests[0].id === requests[1].id;
    }),
  ).toBe(true);
});
