// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ListingCard } from '@/features/house-scanner/components/listing-card';
import { ListingPhoto } from '@/features/house-scanner/components/listing-photo';
import {
  DEMO_USER_ID,
  STALE_LISTING_ID,
  SYNTHETIC_SNAPSHOT,
} from '@/features/house-scanner/mock/synthetic-household';

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

async function renderCard(stale: boolean, details: boolean) {
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
  const listing = SYNTHETIC_SNAPSHOT.listings.find(
    (entry) => entry.id === STALE_LISTING_ID,
  );
  if (!listing) throw new Error('The stale demo listing is missing.');
  render(
    <MantineProvider>
      <ListingCard
        listing={listing}
        snapshot={SYNTHETIC_SNAPSHOT}
        userId={DEMO_USER_ID}
        details={details}
        stale={stale}
        busy={false}
        canSave
        onSelect={() => {}}
        onFavorite={() => {}}
      />
    </MantineProvider>,
  );
}

it('shows the badge and the notice with the last seen date on a stale listing', async () => {
  await renderCard(true, true);
  expect(screen.getByText('Not in latest scan')).toBeTruthy();
  const notice = screen.getByRole('note', {
    name: 'Not seen in the latest scan',
  });
  expect(notice.textContent).toContain(
    'Not seen in the latest scan. Last seen',
  );
  expect(notice.textContent).not.toContain('—');
});

it('shows only the badge in the collapsed summary of a stale listing', async () => {
  await renderCard(true, false);
  expect(screen.getByText('Not in latest scan')).toBeTruthy();
  expect(screen.queryByRole('note')).toBeNull();
});

it('shows neither the badge nor the notice on a listing that is not stale', async () => {
  await renderCard(false, true);
  expect(screen.queryByText('Not in latest scan')).toBeNull();
  expect(screen.queryByRole('note')).toBeNull();
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
    </MantineProvider>,
  );
  return base;
}

it('shows no status badge on an available home', async () => {
  const base = await renderOverridden({});
  expect(base.facts.status).toBe('available');
  expect(screen.queryByText('available')).toBeNull();
  expect(screen.queryByText('Status disputed')).toBeNull();
});

it('shows the status badge when a home is not available or its status is disputed', async () => {
  const base = SYNTHETIC_SNAPSHOT.listings[0];
  await renderOverridden({
    listing: { facts: { ...base.facts, status: 'sold' } },
  });
  expect(screen.getByText('sold')).toBeTruthy();
  cleanup();
  await renderOverridden({ listing: { conflicts: ['status'] } });
  expect(screen.getByText('Status disputed')).toBeTruthy();
});

it('prefixes the match label with the profile name only when several profiles are enabled', async () => {
  const [profile] = SYNTHETIC_SNAPSHOT.profiles;
  await renderOverridden({});
  expect(screen.queryByText(/Fictional demonstration profile:/)).toBeNull();
  cleanup();
  await renderOverridden({
    profiles: [profile, { ...profile, id: 'second-profile', name: 'Second' }],
  });
  expect(screen.getByText(/Fictional demonstration profile:/)).toBeTruthy();
  expect(screen.getByText(/Second:/)).toBeTruthy();
});

it('opens the details dialog from the Details button without expanding the card', async () => {
  const onSelect = vi.fn();
  await renderOverridden({ onSelect });
  const details = screen.getByRole('button', { name: 'Details' });
  expect(details.getAttribute('aria-haspopup')).toBe('dialog');
  expect(details.getAttribute('aria-pressed')).toBeNull();
  fireEvent.click(details);
  expect(onSelect).toHaveBeenCalledOnce();
  expect(screen.queryByText('Facts and source evidence')).toBeNull();
});

it('styles the original-listing link as a default button with the same label and safe link attributes', async () => {
  await renderOverridden({});
  const link = screen.getByRole('link', { name: 'Open original listing' });
  expect(link.getAttribute('data-variant')).toBe('default');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(link.getAttribute('referrerpolicy')).toBe('no-referrer');
});

it('shows up to three fact chips and one caveat chip, with no chip for the caveats every home has', async () => {
  const base = SYNTHETIC_SNAPSHOT.listings[0];
  await renderOverridden({});
  for (const label of ['Balcony', 'Lift', 'Above ground floor'])
    expect(screen.getByText(label)).toBeTruthy();
  expect(screen.queryByText('Glazed')).toBeNull();
  expect(screen.queryByText('Transit not checked')).toBeNull();
  cleanup();
  await renderOverridden({
    listing: { facts: { ...base.facts, stepFree: false } },
  });
  expect(screen.getAllByText('Not step-free').length).toBeGreaterThan(0);
});

it('opens internal details from both the photo fallback and title', async () => {
  const onSelect = vi.fn();
  await renderOverridden({ onSelect });
  fireEvent.click(
    screen.getByRole('button', { name: 'View Example balcony home' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Example balcony home' }));
  expect(onSelect).toHaveBeenCalledTimes(2);
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

it('keeps required lift uncertainty in the compact summary', async () => {
  const base = SYNTHETIC_SNAPSHOT.listings[0];
  await renderOverridden({ listing: { facts: { ...base.facts, lift: null } } });
  expect(screen.getByText('Lift unknown')).toBeTruthy();
  cleanup();
  await renderOverridden({ listing: { conflicts: ['lift'] } });
  expect(screen.getByText('Lift disputed')).toBeTruthy();
});

it('labels selection targets by their action, checked state, and disabled state', async () => {
  await renderOverridden({
    selectionMode: true,
    checked: true,
    selectionDisabled: true,
  });
  const buttons = screen.getAllByRole('button', {
    name: 'Deselect Example balcony home',
  });
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);
  }
  expect(
    screen.queryByRole('button', { name: 'View Example balcony home' }),
  ).toBeNull();
});
