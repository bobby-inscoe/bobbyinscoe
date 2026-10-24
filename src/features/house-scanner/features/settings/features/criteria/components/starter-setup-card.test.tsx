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
import { StarterSetup } from '@/features/house-scanner/features/settings/features/criteria/components/starter-setup-card';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';
import {
  DEMO_OTHER_USER_ID,
  DEMO_USER_ID,
  SYNTHETIC_SNAPSHOT,
} from '@/features/house-scanner/mock/synthetic-household';
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(cleanup);

const starter = SYNTHETIC_SNAPSHOT.profiles[0];

function show(
  userId: string,
  onSave = vi.fn(async (_profile: SearchProfile) => {}),
  revision = 1,
) {
  render(
    <MantineProvider>
      <IntlProvider locale="en-GB" messages={catalogs.en}>
        <StarterSetup
          snapshot={{
            ...SYNTHETIC_SNAPSHOT,
            profiles: [{ ...starter, revision }],
          }}
          userId={userId}
          showCard
          onSave={onSave}
        />
      </IntlProvider>
    </MantineProvider>,
  );
  return onSave;
}

it('lets an owner keep the starter criteria, saving the profile unchanged', async () => {
  const onSave = show(DEMO_USER_ID);
  fireEvent.click(
    screen.getByRole('button', { name: 'Keep starter criteria' }),
  );
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({ ...starter, revision: 1 }),
  );
});

it('saves a lower maximum budget and pulls the preferred budget down with it', async () => {
  const onSave = show(DEMO_USER_ID);
  fireEvent.change(screen.getByLabelText(/Maximum budget/), {
    target: { value: '2500000' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave.mock.calls[0][0].criteria).toMatchObject({
    preferredPriceSek: 2500000,
    stretchPriceSek: 2500000,
  });
});

it('keeps the card and shows the error when a save fails', async () => {
  show(
    DEMO_USER_ID,
    vi.fn(async () => {
      throw new Error('errors.theHouseholdRequestFailedReloadAndTryAgain');
    }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Keep starter criteria' }),
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('Set up your search')).toBeTruthy();
});

it('tells a member that an owner can change the criteria, with no edit control', () => {
  show(DEMO_OTHER_USER_ID);
  expect(screen.getByRole('note').textContent).toMatch(
    /An owner can change them/,
  );
  expect(screen.queryByRole('button')).toBeNull();
});

it('shows nothing once the profile has been saved', () => {
  show(DEMO_USER_ID, undefined, 2);
  expect(screen.queryByText('Set up your search')).toBeNull();
  expect(screen.queryByRole('note')).toBeNull();
});
