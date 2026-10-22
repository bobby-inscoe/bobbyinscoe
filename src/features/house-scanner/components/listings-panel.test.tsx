// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  deferred,
  fixtureSnapshot,
  USER_ID,
} from '@/features/house-scanner/api/session-test-helpers';
import { ListingsPanel } from '@/features/house-scanner/components/listings-panel';
import { useListingNotes } from '@/features/house-scanner/hooks/use-listing-notes';
import { ShellterLanguageProvider } from '@/features/house-scanner/i18n/language-provider';
import { emptyFilters } from '@/features/house-scanner/utils/listing-filters';

type PanelProps = Omit<ComponentProps<typeof ListingsPanel>, 'notes'>;

function PanelHarness(props: PanelProps) {
  const notes = useListingNotes({ listingId: null, userId: USER_ID });
  return (
    <MantineProvider>
      <ShellterLanguageProvider>
        <ListingsPanel {...props} notes={notes} />
      </ShellterLanguageProvider>
    </MantineProvider>
  );
}

function panelProps(onHideMany: PanelProps['onHideMany']): PanelProps {
  const snapshot = fixtureSnapshot();
  return {
    tab: 'suggestions',
    snapshot,
    userId: USER_ID,
    person: 'everyone',
    onPersonChange: vi.fn(),
    section: 'all',
    onSectionChange: vi.fn(),
    filters: emptyFilters,
    hiddenIds: new Set(),
    hiddenCount: 0,
    duplicateCount: 0,
    alsoOn: new Map(),
    onHide: vi.fn(),
    onUnhide: vi.fn(),
    onHideMany,
    onUndoHide: async () => true,
    hideBusy: false,
    hideError: '',
    hideMessage: '',
    undoHideCount: 0,
    canHide: true,
    selecting: true,
    onSelectingChange: vi.fn(),
    filtersOpen: false,
    onFiltersOpenChange: vi.fn(),
    sort: 'newest',
    onSortChange: vi.fn(),
    onFiltersChange: vi.fn(),
    filterHosts: [],
    total: snapshot.listings.length,
    visible: snapshot.listings,
    scoped: snapshot.listings,
    duplicateIds: new Set(),
    selected: null,
    selectedId: null,
    onSelectedIdChange: vi.fn(),
    detailsOpen: false,
    onOpenListing: vi.fn(),
    onCloseListing: vi.fn(),
    onSeeSelectedOnMap: vi.fn(),
    view: 'list',
    onViewChange: vi.fn(),
    satellite: false,
    onSatelliteChange: vi.fn(),
    pending: [],
    canSave: () => true,
    onFavorite: async () => {},
  };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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

function submitBatch() {
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Select Example balcony home' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Hide 1' }));
}

it('closes completed selection through the latest callback after browsing controls change', async () => {
  const request = deferred<boolean>();
  const onHideMany = vi.fn(() => request.promise);
  const props = panelProps(onHideMany);
  const { rerender } = render(<PanelHarness {...props} />);
  submitBatch();
  expect(onHideMany).toHaveBeenCalledWith([props.snapshot.listings[0].id]);
  const onSelectingChange = vi.fn();
  rerender(
    <PanelHarness
      {...props}
      sort="price-asc"
      filters={{ ...emptyFilters, minAreaM2: 60 }}
      onSelectingChange={onSelectingChange}
    />,
  );
  await act(async () => {
    request.resolve(true);
    await request.promise;
  });
  expect(props.onSelectingChange).not.toHaveBeenCalled();
  expect(onSelectingChange).toHaveBeenCalledWith(false);
});

it.each(['tab', 'closed', 'reopened', 'unmounted'] as const)(
  'does not navigate when pending selection context is %s',
  async (change) => {
    const request = deferred<boolean>();
    const props = panelProps(() => request.promise);
    const { rerender, unmount } = render(<PanelHarness {...props} />);
    submitBatch();
    const onSelectingChange = vi.fn();
    if (change === 'unmounted') unmount();
    else if (change === 'tab')
      rerender(
        <PanelHarness
          {...props}
          tab="favorites"
          onSelectingChange={onSelectingChange}
        />,
      );
    else {
      rerender(
        <PanelHarness
          {...props}
          selecting={false}
          onSelectingChange={onSelectingChange}
        />,
      );
      if (change === 'reopened')
        rerender(
          <PanelHarness {...props} onSelectingChange={onSelectingChange} />,
        );
    }
    await act(async () => {
      request.resolve(true);
      await request.promise;
    });
    expect(props.onSelectingChange).not.toHaveBeenCalled();
    expect(onSelectingChange).not.toHaveBeenCalled();
  },
);

it('waits for a checked favorite removal before calculating the bulk save', async () => {
  const props = panelProps(async () => true);
  const first = props.snapshot.listings[0];
  const second = props.snapshot.listings[1];
  const owned = {
    ...props.snapshot.favorites[0],
    listingId: first.id,
    userId: USER_ID,
  };
  props.snapshot = {
    ...props.snapshot,
    favorites: [...props.snapshot.favorites, owned],
  };
  const onSaveMany = vi.fn(async () => true);
  const { rerender } = render(
    <PanelHarness {...props} pending={[first.id]} onSaveMany={onSaveMany} />,
  );
  for (const listing of [first, second])
    fireEvent.click(
      screen.getByRole('checkbox', { name: `Select ${listing.title}` }),
    );
  const waiting = screen.getByRole('button', { name: /^Save 1$/ });
  expect(waiting.hasAttribute('disabled')).toBe(true);
  fireEvent.click(waiting);
  expect(onSaveMany).not.toHaveBeenCalled();

  const refreshed = {
    ...props.snapshot,
    favorites: props.snapshot.favorites.filter((entry) => entry !== owned),
  };
  rerender(
    <PanelHarness
      {...props}
      snapshot={refreshed}
      pending={[]}
      onSaveMany={onSaveMany}
    />,
  );
  const ready = screen.getByRole('button', { name: /^Save 2$/ });
  expect(ready.hasAttribute('disabled')).toBe(false);
  await act(async () => {
    fireEvent.click(ready);
  });
  expect(onSaveMany).toHaveBeenCalledWith([first.id, second.id]);
});

it('does not close a new selection context when an earlier bulk save completes', async () => {
  const request = deferred<boolean>();
  const props = panelProps(async () => true);
  const onSaveMany = vi.fn(() => request.promise);
  const { rerender } = render(
    <PanelHarness {...props} onSaveMany={onSaveMany} />,
  );
  fireEvent.click(
    screen.getByRole('checkbox', { name: 'Select Example balcony home' }),
  );
  fireEvent.click(screen.getByRole('button', { name: /^Save 1$/ }));
  expect(onSaveMany).toHaveBeenCalledOnce();
  const close = vi.fn();
  rerender(
    <PanelHarness
      {...props}
      tab="favorites"
      selecting={false}
      onSaveMany={onSaveMany}
      onSelectingChange={close}
    />,
  );
  await act(async () => {
    request.resolve(true);
    await request.promise;
  });
  expect(props.onSelectingChange).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});

it('mounts list cards in batches and resets the rendered batch when order changes', () => {
  let revealNext = () => {};
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        revealNext = () =>
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      observe() {}
      disconnect() {}
    },
  );
  const props = panelProps(async () => true);
  const listings = Array.from({ length: 70 }, (_, index) => ({
    ...props.snapshot.listings[0],
    id: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    title: `Home ${index}`,
  }));
  const large = {
    ...props,
    snapshot: { ...props.snapshot, listings },
    visible: listings,
    scoped: listings,
  };
  const { rerender } = render(<PanelHarness {...large} />);
  expect(screen.getAllByRole('article')).toHaveLength(32);
  act(revealNext);
  expect(screen.getAllByRole('article')).toHaveLength(64);
  rerender(<PanelHarness {...large} sort="price-asc" />);
  expect(screen.getAllByRole('article')).toHaveLength(32);
  vi.unstubAllGlobals();
});
