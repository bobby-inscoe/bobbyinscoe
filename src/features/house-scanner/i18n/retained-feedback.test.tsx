// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignInForm } from '@/features/house-scanner/features/access/components/sign-in-form';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('reformats retained password-reset feedback and preserves the email without sending another request', async () => {
  const reset = vi.fn(async () => {});
  const content = (language: 'en' | 'sv') => (
    <MantineProvider>
      <IntlProvider
        locale={language === 'sv' ? 'sv-SE' : 'en-GB'}
        messages={catalogs[language]}
      >
        <SignInForm
          title="Shellter"
          onSignIn={vi.fn()}
          onResetPassword={reset}
        />
      </IntlProvider>
    </MantineProvider>
  );
  const view = render(content('en'));
  fireEvent.change(screen.getByRole('textbox', { name: /^Email/ }), {
    target: { value: 'member@example.invalid' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
  fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain(
      'If an account uses that address',
    ),
  );
  view.rerender(content('sv'));
  expect(screen.getByRole('status').textContent).toContain(
    'Om det finns ett konto',
  );
  expect(
    (screen.getByRole('textbox', { name: /^E-post/ }) as HTMLInputElement)
      .value,
  ).toBe('member@example.invalid');
  expect(reset).toHaveBeenCalledExactlyOnceWith('member@example.invalid');
});
