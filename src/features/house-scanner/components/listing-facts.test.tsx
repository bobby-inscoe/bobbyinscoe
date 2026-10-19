// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ListingDetails } from '@/features/house-scanner/components/listing-details';
import {
  KeyFacts,
  MatchLines,
} from '@/features/house-scanner/components/listing-summary';
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
  render(<MantineProvider>{node}</MantineProvider>);

describe('the key facts line', () => {
  it('puts the monthly fee beside area and rooms', () => {
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
      screen.getByText(/70.5 m² · 3 rooms · 4\s250 SEK\/month/),
    ).toBeTruthy();
  });

  it('says the fee is unknown for a flat with none on record, and says nothing for a house', () => {
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

describe('the Missing info label', () => {
  it('names the facts that are unknown, in plain words', () => {
    view(
      <MatchLines
        listing={home({
          glazed: null,
          askingPriceSek: null,
          outdoor: 'balcony',
        })}
        snapshot={SYNTHETIC_SNAPSHOT}
      />,
    );
    const label = screen.getByText(/^Missing info: /).textContent ?? '';
    expect(label).toContain('glazing');
    expect(label).toContain('price');
    expect(label).not.toContain('glazed');
  });

  it('adds nothing to a label whose home is fully known', () => {
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

  it('lists the facts under labelled sections, with the monthly fee among the first', () => {
    details(home({ baseFeeSek: 4250, propertyType: 'apartment', lift: true }));
    expect(screen.getByText('Facts and source evidence')).toBeTruthy();
    for (const heading of [
      'Building and outdoor',
      'Location',
      'Source',
      'Evidence',
      'Notes',
    ])
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    expect(row('Monthly fee').getByText(/4\s250 SEK\/month/)).toBeTruthy();
    expect(row('Lift').getByText('Yes')).toBeTruthy();
    expect(screen.getAllByRole('separator').length).toBeGreaterThanOrEqual(4);
  });

  it('shows what is unknown as Unknown, and a house has no fee row value', () => {
    details(home({ baseFeeSek: null, lift: null, propertyType: 'house' }));
    expect(row('Lift').getByText('Unknown')).toBeTruthy();
    expect(
      row('Monthly fee').getByText('Not applicable to a house'),
    ).toBeTruthy();
  });

  it('keeps the conflict note and the stale notice', () => {
    view(
      <ListingDetails
        listing={home({}, ['askingPriceSek'])}
        snapshot={SYNTHETIC_SNAPSHOT}
        userId={DEMO_USER_ID}
        stale
      />,
    );
    expect(screen.getByText('Conflicting fields: askingPriceSek')).toBeTruthy();
    expect(
      screen.getByRole('note', { name: 'Not seen in the latest scan' }),
    ).toBeTruthy();
  });
});
