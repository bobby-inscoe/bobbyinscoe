// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { FactsLine } from '@/features/house-scanner/components/listing-summary';
import { SYNTHETIC_SNAPSHOT } from '@/features/house-scanner/mock/synthetic-household';
import type { Listing } from '@/features/house-scanner/types/contracts';

afterEach(cleanup);

function renderFacts(coordinates: Listing['coordinates']) {
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
  render(
    <MantineProvider>
      <FactsLine listing={{ ...SYNTHETIC_SNAPSHOT.listings[0], coordinates }} />
    </MantineProvider>,
  );
}

const position = {
  longitude: 11.9,
  latitude: 57.7,
  precision: 'address' as const,
  source: 'Synthetic position',
  observedAt: '2026-10-17T10:00:00Z',
};

it('says an estimated position is estimated from the address', () => {
  renderFacts({ ...position, estimated: true });
  expect(screen.getByText(/Estimated from the address/)).toBeTruthy();
});

it('says nothing about a position the source supplied or a missing one', () => {
  renderFacts(position);
  expect(screen.queryByText(/Estimated from the address/)).toBeNull();
  cleanup();
  renderFacts(null);
  expect(screen.queryByText(/Estimated from the address/)).toBeNull();
});
