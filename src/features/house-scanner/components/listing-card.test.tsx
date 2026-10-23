// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ListingCard } from '@/features/house-scanner/components/listing-card';
import { ListingPhoto } from '@/features/house-scanner/components/listing-photo';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';
import {
  DEMO_OTHER_USER_ID,
  DEMO_USER_ID,
  STALE_LISTING_ID,
  SYNTHETIC_SNAPSHOT,
} from '@/features/house-scanner/mock/synthetic-household';

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('removes a permitted photo as soon as its display permission expires', async () => {
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
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
  const { MantineProvider } = await import('@mantine/core');
  render(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        <ListingPhoto
          listing={{
            ...SYNTHETIC_SNAPSHOT.listings[0],
            photo: {
              url: 'https://images.example.invalid/synthetic.jpg',
              attribution: 'Synthetic author',
              rightsBasis: 'Authored fixture',
              observedAt: '2026-10-12T12:00:00Z',
              expiresAt: '2026-10-12T12:00:01Z',
              displayAllowed: true,
              hotlinkAllowed: true,
            },
          }}
        />
      </IntlProvider>
    </MantineProvider>,
  );
  expect(
    screen
      .getByRole('img', { name: 'Example balcony home' })
      .getAttribute('referrerpolicy'),
  ).toBe('no-referrer');
  await act(async () => {
    vi.advanceTimersByTime(1001);
  });
  expect(
    screen.queryByRole('img', { name: 'Example balcony home' }),
  ).toBeNull();
  expect(screen.getByText('No photo')).toBeTruthy();
});

async function renderCard(
  delisted: boolean,
  details: boolean,
  status: 'available' | 'sold' = 'available',
) {
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
  const { MantineProvider } = await import('@mantine/core');
  const found = SYNTHETIC_SNAPSHOT.listings.find(
    (entry) => entry.id === STALE_LISTING_ID,
  );
  if (!found) throw new Error('The older demo listing is missing.');
  const listing = {
    ...found,
    facts: { ...found.facts, status },
    ...(delisted ? { delistedAt: '2026-10-21T09:00:00Z' } : {}),
  };
  render(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        <ListingCard
          listing={listing}
          snapshot={SYNTHETIC_SNAPSHOT}
          userId={DEMO_USER_ID}
          details={details}
          busy={false}
          canSave
          onSelect={() => {}}
          onFavorite={() => {}}
        />
      </IntlProvider>
    </MantineProvider>,
  );
}

it('marks a listing no longer listed with a badge, and a notice with both dates when expanded', async () => {
  await renderCard(true, true);
  // The badge, and the match line that says why it is outside the criteria.
  expect(screen.getAllByText('No longer listed').length).toBeGreaterThan(0);
  const notice = screen.getByRole('note', { name: 'No longer listed' });
  expect(notice.textContent).toContain('No longer listed since');
  expect(notice.textContent).toContain('Last seen');
  cleanup();
  await renderCard(true, false);
  expect(screen.getByText('No longer listed')).toBeTruthy();
  expect(screen.queryByRole('note')).toBeNull();
  cleanup();
  await renderCard(false, true);
  expect(screen.queryByText('No longer listed')).toBeNull();
  expect(screen.queryByRole('note')).toBeNull();
});

it('lets a sold status speak for a listing no longer listed', async () => {
  await renderCard(true, false, 'sold');
  expect(screen.getByText('Sold')).toBeTruthy();
  expect(screen.queryByText('No longer listed')).toBeNull();
});

it('names the member who hid the home', async () => {
  stubMatchMedia();
  const { MantineProvider } = await import('@mantine/core');
  const listing = SYNTHETIC_SNAPSHOT.listings[0];
  render(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        <ListingCard
          listing={listing}
          snapshot={{
            ...SYNTHETIC_SNAPSHOT,
            hides: [
              {
                listingId: listing.id,
                userId: DEMO_OTHER_USER_ID,
                hiddenAt: '2026-10-20T12:00:00Z',
              },
            ],
          }}
          userId={DEMO_USER_ID}
          details={false}
          busy={false}
          canSave
          hidden
          onSelect={() => {}}
          onFavorite={() => {}}
        />
      </IntlProvider>
    </MantineProvider>,
  );
  expect(screen.getByText('Hidden by Demo Morgan')).toBeTruthy();
});

function stubMatchMedia() {
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
}

type CardOverrides = {
  listing?: Partial<(typeof SYNTHETIC_SNAPSHOT.listings)[number]>;
  profiles?: typeof SYNTHETIC_SNAPSHOT.profiles;
  onSelect?: () => void;
  selectionMode?: boolean;
  selectionDisabled?: boolean;
  checked?: boolean;
  onToggleSelection?: (id: string) => void;
  onFavorite?: () => void;
};

async function renderOverridden({
  listing,
  profiles,
  onSelect,
  selectionMode,
  selectionDisabled,
  checked,
  onToggleSelection,
  onFavorite,
}: CardOverrides) {
  stubMatchMedia();
  const { MantineProvider } = await import('@mantine/core');
  const base = SYNTHETIC_SNAPSHOT.listings[0];
  render(
    <MantineProvider>
      <IntlProvider
        locale="en-GB"
        defaultLocale="en-GB"
        timeZone="Europe/Stockholm"
        messages={catalogs.en}
      >
        <ListingCard
          listing={{ ...base, ...listing }}
          snapshot={{
            ...SYNTHETIC_SNAPSHOT,
            profiles: profiles ?? SYNTHETIC_SNAPSHOT.profiles,
          }}
          userId={DEMO_USER_ID}
          busy={false}
          canSave
          selectionMode={selectionMode}
          selectionDisabled={selectionDisabled}
          checked={checked}
          onToggleSelection={onToggleSelection}
          onSelect={onSelect ?? (() => {})}
          onFavorite={onFavorite ?? (() => {})}
        />
      </IntlProvider>
    </MantineProvider>,
  );
  return base;
}

it('shows a status badge only when a home is not available or its status is disputed', async () => {
  const base = await renderOverridden({});
  expect(base.facts.status).toBe('available');
  expect(screen.queryByText('available')).toBeNull();
  expect(screen.queryByText('Status disputed')).toBeNull();
  cleanup();
  await renderOverridden({
    listing: { facts: { ...base.facts, status: 'unknown' } },
  });
  expect(screen.queryByText('unknown', { exact: true })).toBeNull();
  cleanup();
  await renderOverridden({
    listing: { facts: { ...base.facts, status: 'sold' } },
  });
  expect(screen.getByText('Sold')).toBeTruthy();
  cleanup();
  await renderOverridden({ listing: { conflicts: ['status'] } });
  expect(screen.getByText('Status disputed')).toBeTruthy();
});

it('opens details from the Details button, the photo and the title without expanding the card', async () => {
  const onSelect = vi.fn();
  await renderOverridden({ onSelect });
  fireEvent.click(screen.getByRole('article'));
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'View Example balcony home' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Example balcony home' }));
  expect(onSelect).toHaveBeenCalledTimes(3);
  expect(screen.queryByText('Facts and source evidence')).toBeNull();
});

it('opens the original listing in a new tab without sending a referrer', async () => {
  await renderOverridden({});
  const link = screen.getByRole('link', { name: 'Open original listing' });
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(link.getAttribute('referrerpolicy')).toBe('no-referrer');
});

it('toggles selected rows without navigating and keeps details and favorite independent', async () => {
  const onSelect = vi.fn();
  const onToggleSelection = vi.fn();
  const onFavorite = vi.fn();
  const listing = await renderOverridden({
    onSelect,
    onFavorite,
    selectionMode: true,
    onToggleSelection,
  });
  fireEvent.click(
    screen.getByRole('checkbox', { name: `Select ${listing.title}` }),
  );
  fireEvent.click(
    screen.getAllByRole('button', { name: `Select ${listing.title}` })[0],
  );
  fireEvent.click(screen.getByRole('article'));
  fireEvent.keyDown(screen.getByRole('article'), { key: ' ' });
  expect(onToggleSelection).toHaveBeenCalledTimes(4);
  expect(onToggleSelection).toHaveBeenLastCalledWith(listing.id);
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save favorite' }));
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onFavorite).toHaveBeenCalledOnce();
  expect(onToggleSelection).toHaveBeenCalledTimes(4);
});

it('prevents selection changes while saving while keeping explicit details available', async () => {
  const onSelect = vi.fn();
  const onToggleSelection = vi.fn();
  await renderOverridden({
    onSelect,
    selectionMode: true,
    selectionDisabled: true,
    onToggleSelection,
  });
  expect(screen.getByRole('checkbox').hasAttribute('disabled')).toBe(true);
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Select Example balcony home' })[0],
  );
  fireEvent.click(screen.getByRole('article'));
  expect(onToggleSelection).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Details' }));
  expect(onSelect).toHaveBeenCalledOnce();
});

it('keeps photo attribution and a working detail target when an image fails', async () => {
  const onSelect = vi.fn();
  await renderOverridden({
    onSelect,
    listing: {
      photos: [],
      photo: {
        url: 'https://images.example.invalid/synthetic.jpg',
        attribution: 'Synthetic author',
        rightsBasis: 'Authored fixture',
        observedAt: '2026-10-12T12:00:00Z',
        expiresAt: '2099-10-12T12:00:01Z',
        displayAllowed: true,
        hotlinkAllowed: true,
      },
    },
  });
  expect(screen.getByText('Synthetic author')).toBeTruthy();
  expect(
    screen
      .getByRole('img', { name: 'Example balcony home' })
      .getAttribute('referrerpolicy'),
  ).toBe('no-referrer');
  fireEvent.error(screen.getByRole('img', { name: 'Example balcony home' }));
  expect(
    screen.queryByRole('img', { name: 'Example balcony home' }),
  ).toBeNull();
  expect(screen.queryByText('Synthetic author')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'View Example balcony home' }),
  );
  expect(onSelect).toHaveBeenCalledOnce();
});
