// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EstimateLine } from '@/features/house-scanner/components/price-estimate';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type { Listing } from '@/features/house-scanner/types/contracts';

const base = SYNTHETIC_SNAPSHOT.listings[0];
const target: Listing = {
  ...base,
  facts: { ...base.facts, askingPriceSek: null },
  priceEstimate: {
    lowSek: 2_800_000,
    highSek: 3_750_000,
    finalSek: 3_420_000,
    nearby: 6,
    farthestM: 660,
    levelUsed: false,
  },
};

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
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(listing: Listing, language: 'en' | 'sv' = 'en') {
  render(
    <MantineProvider>
      <IntlProvider
        locale={language === 'en' ? 'en-GB' : 'sv-SE'}
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs[language]}
      >
        <EstimateLine listing={listing} />
      </IntlProvider>
    </MantineProvider>,
  );
}

it('shows the database range and the likely final price', () => {
  show(target);
  expect(screen.getByText(/Estimate 2.8M–3.8M/)).toBeTruthy();
  expect(screen.getByText(/likely final 3.4M/)).toBeTruthy();
});

it('says the same in Swedish', () => {
  show(target, 'sv');
  expect(screen.getByText(/Uppskattning/)).toBeTruthy();
  expect(screen.getByText(/troligt slutpris/)).toBeTruthy();
});

it('shows nothing for a home without an estimate', () => {
  const { container } = render(
    <MantineProvider>
      <IntlProvider locale="en-GB" messages={catalogs.en}>
        <EstimateLine listing={{ ...target, priceEstimate: undefined }} />
      </IntlProvider>
    </MantineProvider>,
  );
  expect(container.querySelector('p')).toBeNull();
});
