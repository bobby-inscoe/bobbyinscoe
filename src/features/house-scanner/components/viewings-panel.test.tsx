// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ViewingsPanel } from '@/features/house-scanner/components/viewings-panel';
import {
  DEMO_OTHER_USER_ID,
  DEMO_USER_ID,
  SYNTHETIC_SNAPSHOT,
} from '@/features/house-scanner/mock/synthetic-household';
import type { Snapshot } from '@/features/house-scanner/types/contracts';

// Saturday 17 October 2026, 11:00 in Stockholm.
const NOW = new Date('2026-10-17T09:00:00Z');
const [first, second, third] = SYNTHETIC_SNAPSHOT.listings;
const photo = {
  url: 'https://images.example.invalid/exempelgatan.jpg',
  attribution: 'Synthetic author',
  rightsBasis: 'Authored fixture',
  observedAt: '2026-10-17T09:00:00Z',
  expiresAt: '2026-10-18T09:00:00Z',
  displayAllowed: true,
  hotlinkAllowed: true,
} as const;
const favorite = (listingId: string, userId: string) => ({
  householdId: SYNTHETIC_SNAPSHOT.householdId,
  listingId,
  userId,
  savedAt: '2026-10-16T10:00:00Z',
});
const snapshot: Snapshot = {
  ...SYNTHETIC_SNAPSHOT,
  favorites: [
    favorite(first.id, DEMO_OTHER_USER_ID),
    favorite(second.id, DEMO_USER_ID),
    favorite(third.id, DEMO_USER_ID),
  ],
  listings: [
    {
      ...first,
      title: 'Exempelgatan 1',
      photo,
      viewings: [
        { startsAt: '2026-10-18T12:00:00Z', endsAt: '2026-10-18T13:00:00Z' },
      ],
    },
    {
      ...second,
      title: 'Provgatan 7',
      viewings: [
        { startsAt: '2026-10-24T13:00:00Z', endsAt: null },
        { startsAt: '2026-10-01T13:00:00Z', endsAt: null },
      ],
    },
    // Saved, but the broker lists no times.
    { ...third, title: 'Teststigen 3' },
    // Not saved by anyone, so it has no place on the timeline.
    {
      ...SYNTHETIC_SNAPSHOT.listings[3],
      title: 'Ospard 9',
      viewings: [{ startsAt: '2026-10-19T12:00:00Z', endsAt: null }],
    },
  ],
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const onOpenListing = vi.fn();
const onSeeOnMap = vi.fn();

const show = (state: Snapshot = snapshot) =>
  render(
    <MantineProvider env="test">
      <ViewingsPanel
        snapshot={state}
        userId={DEMO_USER_ID}
        person="everyone"
        onPersonChange={vi.fn()}
        onOpenListing={onOpenListing}
        onSeeOnMap={onSeeOnMap}
      />
    </MantineProvider>,
  );

it('lists saved homes with an upcoming viewing under Tomorrow and the date, and leaves out past, unsaved and time-less homes', () => {
  show();
  expect(
    screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent),
  ).toEqual(['Tomorrow', 'Sat 24 Oct']);
  expect(screen.getByText('Exempelgatan 1')).toBeTruthy();
  expect(screen.getByText('Sun 18 Oct, 14:00–15:00')).toBeTruthy();
  expect(screen.getByText('Sat 24 Oct, 15:00')).toBeTruthy();
  expect(
    screen.getByRole('img', { name: 'Exempelgatan 1' }).getAttribute('src'),
  ).toBe(photo.url);
  expect(screen.getByText('Synthetic author')).toBeTruthy();
  expect(screen.getAllByText('No photo')).toHaveLength(1);
  expect(screen.queryByText('Ospard 9')).toBeNull();
  expect(screen.queryByText('Teststigen 3')).toBeNull();
  expect(screen.queryByText(/Thu 1 Oct/)).toBeNull();
  const section = screen
    .getByRole('heading', { name: 'Tomorrow' })
    .closest('section');
  expect(
    within(section as HTMLElement).getByText(/Saved by .+/).textContent,
  ).toContain('Saved by');
});

it('says what to do when nothing is ahead, and that times can change', () => {
  show({ ...snapshot, favorites: [] });
  expect(
    screen.getByText(/No saved home has an upcoming viewing/),
  ).toBeTruthy();
  expect(screen.getByText(/can be cancelled or moved/)).toBeTruthy();
});

it('hands the browser a calendar file with a week and a day reminder when Add to calendar is pressed', async () => {
  let blob: Blob | undefined;
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (value: Blob) => {
      blob = value;
      return 'blob:calendar';
    },
    revokeObjectURL: () => {},
  });
  show();
  fireEvent.click(
    screen.getByRole('button', {
      name: /Add to calendar: Exempelgatan 1, Sun 18 Oct/,
    }),
  );
  expect(click).toHaveBeenCalledOnce();
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob as Blob);
  });
  expect(blob?.type).toContain('text/calendar');
  expect(text).toContain('SUMMARY:Viewing: Exempelgatan 1');
  expect(text).toContain('DTSTART:20261018T120000Z');
  expect(text).toContain('TRIGGER:-P7D');
  expect(text).toContain('TRIGGER:-P1D');
});

it('opens details from the photo, title and Details, with no broker link on the card', () => {
  show();
  expect(screen.queryByRole('heading', { name: 'Viewings' })).toBeNull();
  const card = screen.getByRole('article', { name: /^Exempelgatan 1,/ });
  expect(within(card).queryByRole('link')).toBeNull();
  for (const name of ['View Exempelgatan 1', 'Exempelgatan 1', 'Details']) {
    onOpenListing.mockClear();
    fireEvent.click(within(card).getByRole('button', { name }));
    expect(onOpenListing).toHaveBeenCalledExactlyOnceWith(first.id);
  }
});

it('shares the broker link from More and opens a located home on the map', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  show();
  const card = screen.getByRole('article', { name: /^Exempelgatan 1,/ });
  fireEvent.click(
    within(card).getByRole('button', {
      name: 'More actions for Exempelgatan 1',
    }),
  );
  const share = await screen.findByRole('menuitem', {
    name: 'Share this listing',
  });
  await act(async () => {
    fireEvent.click(share);
  });
  expect(writeText).toHaveBeenCalledWith(first.sourceUrls[0]);
  expect(
    await screen.findByRole('menuitem', { name: 'Link copied' }),
  ).toBeTruthy();
  fireEvent.click(await screen.findByRole('menuitem', { name: 'See on map' }));
  expect(onSeeOnMap).toHaveBeenCalledExactlyOnceWith(first.id);
});

it('omits See on map for homes without a usable location', async () => {
  show({
    ...snapshot,
    listings: [{ ...snapshot.listings[0], coordinates: null }],
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'More actions for Exempelgatan 1' }),
  );
  expect(
    await screen.findByRole('menuitem', { name: 'Share this listing' }),
  ).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'See on map' })).toBeNull();
});
