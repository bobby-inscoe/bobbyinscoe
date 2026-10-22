// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListingDetails } from '@/features/house-scanner/components/listing-details';
import {
  KeyFacts,
  MatchLines,
} from '@/features/house-scanner/components/listing-summary';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';
import {
  DEMO_USER_ID,
  SYNTHETIC_SNAPSHOT,
} from '@/features/house-scanner/mock/synthetic-household';
import type { Listing } from '@/features/house-scanner/types/contracts';

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

const base = SYNTHETIC_SNAPSHOT.listings[0];
function home(
  facts: Partial<Listing['facts']> = {},
  conflicts: Listing['conflicts'] = [],
): Listing {
  return { ...base, facts: { ...base.facts, ...facts }, conflicts };
}
const view = (node: React.ReactNode) =>
  render(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        {node}
      </IntlProvider>
    </MantineProvider>,
  );

describe('the key facts line', () => {
  it('puts the monthly fee beside area and rooms, says when a flat has none on record, and says nothing for a house', () => {
    view(
      <KeyFacts
        listing={home({
          livingAreaM2: 70.5,
          rooms: 3,
          baseFeeSek: 4250,
          propertyType: 'apartment',
        })}
      />,
    );
    expect(
      screen.getByText(/70.5 m² · 3 rooms · 4,250 SEK\/month/),
    ).toBeTruthy();
    cleanup();
    view(
      <KeyFacts
        listing={home({ baseFeeSek: null, propertyType: 'apartment' })}
      />,
    );
    expect(screen.getByText(/Fee unknown/)).toBeTruthy();
    cleanup();
    view(
      <KeyFacts listing={home({ baseFeeSek: null, propertyType: 'house' })} />,
    );
    expect(screen.queryByText(/Fee|SEK\/month/)).toBeNull();
  });

  it('marks a disputed fee, area or room count', () => {
    view(
      <KeyFacts
        listing={home({ baseFeeSek: 4250 }, [
          'baseFeeSek',
          'livingAreaM2',
          'rooms',
        ])}
      />,
    );
    const line = screen.getByText(/rooms/).textContent ?? '';
    expect(line.match(/\(disputed\)/g)).toHaveLength(3);
  });
});

it('names the unknown facts in plain words, and shows no Missing info label for a fully known home', () => {
  view(
    <MatchLines
      listing={home({ glazed: null, askingPriceSek: null, outdoor: 'balcony' })}
      snapshot={SYNTHETIC_SNAPSHOT}
    />,
  );
  const label = screen.getByText(/^Missing info: /).textContent ?? '';
  expect(label).not.toContain('glazing');
  expect(label).toContain('price');
  expect(label).not.toContain('glazed');
  cleanup();
  view(
    <MatchLines
      listing={home({
        glazed: true,
        outdoor: 'balcony',
        lift: true,
        groundFloor: false,
        askingPriceSek: 2_500_000,
        baseFeeSek: 3000,
      })}
      snapshot={SYNTHETIC_SNAPSHOT}
    />,
  );
  expect(screen.queryByText(/Missing info/)).toBeNull();
});

describe('the details sheet', () => {
  const details = (listing: Listing) =>
    view(
      <ListingDetails
        listing={listing}
        snapshot={SYNTHETIC_SNAPSHOT}
        userId={DEMO_USER_ID}
      />,
    );
  const row = (label: string) => {
    const term = screen.getByText(label, { selector: 'dt' });
    const found = term.parentElement;
    if (!found) throw new Error(`No row for ${label}`);
    return within(found);
  };

  it('shows known facts, Unknown for missing ones, and no fee for a house', () => {
    details(home({ baseFeeSek: 4250, propertyType: 'apartment', lift: true }));
    expect(row('Monthly fee').getByText(/4,250 SEK\/month/)).toBeTruthy();
    expect(row('Lift').getByText('Yes')).toBeTruthy();
    cleanup();
    details(home({ baseFeeSek: null, lift: null, propertyType: 'house' }));
    expect(row('Lift').getByText('Unknown')).toBeTruthy();
    expect(
      row('Monthly fee').getByText('Not applicable to a house'),
    ).toBeTruthy();
  });

  it('keeps the conflict note and the no longer listed notice', () => {
    details({
      ...home({}, ['askingPriceSek']),
      delistedAt: '2026-10-21T09:00:00Z',
    });
    expect(screen.getByText('Conflicting fields: Asking price')).toBeTruthy();
    expect(screen.getByRole('note', { name: 'No longer listed' })).toBeTruthy();
  });
});
