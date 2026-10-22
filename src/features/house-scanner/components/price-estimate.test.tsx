// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  EstimateLine,
  PriceEstimateProvider,
} from '@/features/house-scanner/components/price-estimate';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type { Listing } from '@/features/house-scanner/types/contracts';

const base = SYNTHETIC_SNAPSHOT.listings[0];
let counter = 0;
function flat(title: string, east: number, price: number | null): Listing {
  counter += 1;
  return {
    ...base,
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    title,
    conflicts: [],
    coordinates: {
      latitude: 57.7,
      longitude: 11.95 + east / (111_320 * Math.cos((57.7 * Math.PI) / 180)),
      precision: 'address',
      source: 'test',
      observedAt: base.observedAt,
    },
    facts: {
      ...base.facts,
      propertyType: 'apartment',
      livingAreaM2: 100,
      askingPriceSek: price,
    },
  };
}

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

const neighbours = Array.from({ length: 8 }, (_v, i) =>
  flat(`Grannvägen ${i + 1}`, 100 * (i + 1), i < 4 ? 5_000_000 : 6_000_000),
);
const target = flat('Målgatan 1', 0, null);

function show(listing: Listing, others: Listing[]) {
  render(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        <PriceEstimateProvider listings={[...others, listing]}>
          <EstimateLine listing={listing} />
        </PriceEstimateProvider>
      </IntlProvider>
    </MantineProvider>,
  );
}

it('shows the range and what it rests on for a home with no price', () => {
  show(target, neighbours);
  expect(screen.getByText(/Estimate 4.3M–6.9M/)).toBeTruthy();
  expect(screen.getByText(/from 8 nearby asking prices/)).toBeTruthy();
});

it('shows nothing for a home with a price, or when there are too few neighbours', () => {
  show(neighbours[0], neighbours.slice(1));
  expect(screen.queryByText(/Estimate/)).toBeNull();
  cleanup();
  show(target, neighbours.slice(0, 4));
  expect(screen.queryByText(/Estimate/)).toBeNull();
});
