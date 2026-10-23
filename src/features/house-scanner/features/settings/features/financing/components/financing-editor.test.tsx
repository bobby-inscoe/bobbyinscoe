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
import { FinancingEditor } from '@/features/house-scanner/features/settings/features/financing/components/financing-editor';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type { SearchProfile } from '@/features/house-scanner/types/contracts';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    (media: string): MediaQueryList => ({
      media,
      matches: false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }),
  );
});
afterEach(cleanup);

const demo = SYNTHETIC_SNAPSHOT.profiles[0];

function show(profile: SearchProfile, canEdit = true) {
  const onSave = vi.fn(async (_saved: SearchProfile) => {});
  render(
    <MantineProvider>
      <IntlProvider locale="en-GB" messages={catalogs.en}>
        <FinancingEditor profile={profile} canEdit={canEdit} onSave={onSave} />
      </IntlProvider>
    </MantineProvider>,
  );
  return onSave;
}

it('saves only financing onto the saved criteria, and removes it to follow the typical values', async () => {
  const onSave = show(demo);
  expect(screen.getByText(/Using typical values/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Cash for the down payment (SEK)'), {
    target: { value: '600000' },
  });
  fireEvent.change(screen.getByLabelText('Interest rate (%)'), {
    target: { value: '3.1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save financing' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0]).toEqual({
    ...demo,
    criteria: {
      ...demo.criteria,
      financing: {
        cashSek: 600000,
        interestRatePercent: 3.1,
        taxDeduction: true,
      },
    },
  });

  cleanup();
  const withFinancing = {
    ...demo,
    criteria: {
      ...demo.criteria,
      financing: { cashSek: null, interestRatePercent: 3, taxDeduction: true },
    },
  };
  const again = show(withFinancing);
  fireEvent.click(screen.getByRole('button', { name: 'Use typical values' }));
  await waitFor(() => expect(again).toHaveBeenCalledTimes(1));
  expect(again.mock.calls[0][0].criteria).toEqual(demo.criteria);
});

it('is read-only for members who are not owners', () => {
  show(demo, false);
  expect(
    (
      screen.getByRole('button', {
        name: 'Save financing',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(screen.getByText(/Only household owners/)).toBeTruthy();
});
