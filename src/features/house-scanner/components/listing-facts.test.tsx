// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListingDetails } from '@/features/house-scanner/components/listing-details';
import {
  KeyFacts,
  MatchLines,
  PriceLine,
} from '@/features/house-scanner/components/listing-summary';
import { SettingsPanel } from '@/features/house-scanner/features/settings/components/settings-panel';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';
import { ShellterLanguageProvider } from '@/features/house-scanner/i18n/language-provider';
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

it('keeps sign out available in Settings through the existing session callback', () => {
  const onSignOut = vi.fn();
  localStorage.setItem('shellter.language', 'en');
  view(
    <ShellterLanguageProvider>
      <SettingsPanel
        snapshot={{ ...SYNTHETIC_SNAPSHOT, profiles: [] }}
        userId={DEMO_USER_ID}
        synthetic={false}
        onSignOut={onSignOut}
      />
    </ShellterLanguageProvider>,
  );
  localStorage.removeItem('shellter.language');
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(onSignOut).toHaveBeenCalledOnce();
});

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
  const details = (listing: Listing, snapshot = SYNTHETIC_SNAPSHOT) =>
    view(
      <>
        <PriceLine listing={listing} />
        <ListingDetails
          listing={listing}
          snapshot={snapshot}
          userId={DEMO_USER_ID}
        />
      </>,
    );
  const row = (label: string) => {
    const term = screen.getByText(label, { selector: 'dt' });
    const found = term.parentElement;
    if (!found) throw new Error(`No row for ${label}`);
    return within(found);
  };

  it('shows unknown apartment facts and omits inapplicable house facts', () => {
    details(home({ baseFeeSek: 4250, propertyType: 'apartment', lift: true }));
    expect(row('Base monthly fee').getByText(/4,250 SEK\/month/)).toBeTruthy();
    expect(row('Lift').getByText('Yes')).toBeTruthy();
    cleanup();
    details(home({ baseFeeSek: null, lift: null, propertyType: 'house' }));
    expect(screen.queryByText('Lift', { selector: 'dt' })).toBeNull();
    expect(
      screen.queryByText('Base monthly fee', { selector: 'dt' }),
    ).toBeNull();
  });

  it('keeps disputes beside their values and the no longer listed notice', () => {
    details({
      ...home({}, ['askingPriceSek', 'livingAreaM2', 'glazed']),
      delistedAt: '2026-10-21T09:00:00Z',
    });
    expect(row('Living area').getByText('(disputed)')).toBeTruthy();
    expect(row('Glazed outdoor space').getByText('(disputed)')).toBeTruthy();
    expect(screen.getAllByText('(disputed)')).toHaveLength(3);
    expect(screen.getByRole('note', { name: 'No longer listed' })).toBeTruthy();
  });

  it('hides home type and ownership even when recorded or disputed', () => {
    details(
      home({ propertyType: 'apartment', tenure: 'cooperative' }, [
        'propertyType',
        'tenure',
      ]),
    );
    expect(screen.queryByText('Home type', { selector: 'dt' })).toBeNull();
    expect(screen.queryByText('Ownership', { selector: 'dt' })).toBeNull();
  });

  it('shows confirmed bidding as the status and only published bid amounts', () => {
    details(
      home({ status: 'available', bidding: true, highestBidSek: 3100000 }),
    );
    expect(row('Status').getByText('Bidding under way')).toBeTruthy();
    expect(row('Highest bid').getByText('3,100,000 SEK')).toBeTruthy();
    expect(screen.queryByText('Bidding', { selector: 'dt' })).toBeNull();
    cleanup();
    details(home({ status: 'sold', bidding: true, highestBidSek: null }));
    expect(row('Status').getByText('Sold')).toBeTruthy();
    expect(screen.queryByText('Highest bid', { selector: 'dt' })).toBeNull();
    cleanup();
    details(home({ status: 'available', bidding: true }, ['bidding']));
    expect(row('Status').queryByText('Bidding under way')).toBeNull();
    expect(row('Status').getByText('(disputed)')).toBeTruthy();
  });

  it('hides unknown optional facts but keeps known extras and disputed unknown glazing', () => {
    details(
      home({
        mandatoryMonthlySek: null,
        glazed: null,
        tenure: 'unknown',
        bidding: null,
        highestBidSek: null,
      }),
    );
    for (const label of [
      'Required monthly extras',
      'Glazed outdoor space',
      'Ownership',
      'Bidding',
      'Highest bid',
    ]) {
      expect(screen.queryByText(label, { selector: 'dt' })).toBeNull();
    }
    cleanup();
    details(home({ mandatoryMonthlySek: 250, glazed: null }, ['glazed']));
    expect(
      row('Required monthly extras').getByText(/250 SEK\/month/),
    ).toBeTruthy();
    expect(row('Glazed outdoor space').getByText('Unknown')).toBeTruthy();
    expect(row('Glazed outdoor space').getByText('(disputed)')).toBeTruthy();
  });

  it('compares only trustworthy fees and totals with enabled profile preferences', () => {
    details(home({ baseFeeSek: 5100, mandatoryMonthlySek: null }));
    expect(
      row('Base monthly fee').getByText(
        /Above preference \(5,000 SEK\/month\)/,
      ),
    ).toBeTruthy();
    cleanup();
    details(home({ baseFeeSek: 4900, mandatoryMonthlySek: 200 }));
    expect(
      row('Required monthly extras').getByText(/Total above preference/),
    ).toBeTruthy();
    expect(row('Base monthly fee').queryByText(/Above preference/)).toBeNull();
    cleanup();
    details(
      home({ baseFeeSek: 4900, mandatoryMonthlySek: 200 }, [
        'mandatoryMonthlySek',
      ]),
    );
    expect(screen.queryByText(/above preference/i)).toBeNull();
    cleanup();
    details(home({ baseFeeSek: 5100 }, ['baseFeeSek']));
    expect(screen.queryByText(/above preference/i)).toBeNull();
    cleanup();
    details(home({ baseFeeSek: 5100 }), {
      ...SYNTHETIC_SNAPSHOT,
      profiles: SYNTHETIC_SNAPSHOT.profiles.map((profile) => ({
        ...profile,
        enabled: false,
      })),
    });
    expect(screen.queryByText(/above preference/i)).toBeNull();
  });

  it('shows one accurately labelled timestamp, with the rest available on demand', async () => {
    details(home());
    expect(screen.getByText(/^Last changed:/)).toBeTruthy();
    expect(screen.queryByText('Last checked', { selector: 'span' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'About these timestamps' }),
    );
    expect(
      await screen.findByText('Last checked', { selector: 'span' }),
    ).toBeTruthy();
    expect(
      screen.queryByText(/Position checked|Last observed|First found/),
    ).toBeNull();
    cleanup();
    details({ ...home(), lastChangedAt: null });
    expect(screen.getByText(/^Last checked:/)).toBeTruthy();
    cleanup();
    details({ ...home(), lastChangedAt: null, lastCheckedAt: undefined });
    expect(screen.getByText(/^Last checked:/)).toBeTruthy();
  });
});
