import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';
import type { WorkspaceTab } from '@/features/house-scanner/types/household';
import {
  type BrowseSearch,
  toUrlSearch,
  validateBrowseSearch,
} from '@/features/house-scanner/utils/browse-search';
import { emptyFilters } from '@/features/house-scanner/utils/listing-filters';

type Layer = 'filterOpen' | 'select';
interface BrowseOrigin {
  index: number;
  pathname: string;
  search: BrowseSearch;
}
declare module '@tanstack/react-router' {
  interface HistoryState {
    houseScannerLayers?: Partial<Record<Layer, BrowseOrigin>>;
    houseScannerDetailOrigin?: BrowseOrigin;
  }
}

const PREFIX = '/shellter';
const destinations = {
  suggestions: '/shellter/listings',
  favorites: '/shellter/favorites',
  viewings: '/shellter/viewings',
  manual: '/shellter/add-link',
  settings: '/shellter/settings',
} as const;

export function useBrowseNavigation() {
  const navigate = useNavigate();
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const search = useRouterState({
    select: (state) => validateBrowseSearch(state.location.search),
    structuralSharing: true,
  });
  const detailMatch = /^\/shellter\/listings\/([^/]+)\/?$/.exec(
    location.pathname,
  );
  const listingId = detailMatch?.[1] ?? null;
  const tab = listingId
    ? search.from === 'favorites'
      ? 'favorites'
      : search.from === 'viewings'
        ? 'viewings'
        : 'suggestions'
    : ((Object.entries(destinations).find(
        ([, path]) => path === location.pathname,
      )?.[0] as WorkspaceTab | undefined) ?? 'suggestions');
  const layers = location.state.houseScannerLayers ?? {};
  const origin = (): BrowseOrigin => ({
    index: location.state.__TSR_index,
    pathname: location.pathname,
    search,
  });

  useEffect(() => {
    if (location.pathname === PREFIX || location.pathname === `${PREFIX}/`) {
      void navigate({
        to: destinations.suggestions,
        search: toUrlSearch(search),
        replace: true,
      });
    }
  }, [location.pathname, navigate, search]);

  async function returnTo(
    previous: BrowseOrigin,
    nextSearch: BrowseSearch,
    nextLayers: Partial<Record<Layer, BrowseOrigin>> = {},
  ) {
    const distance = previous.index - location.state.__TSR_index;
    if (distance < 0) {
      await new Promise<void>((resolve) => {
        const unsubscribe = router.history.subscribe(() => {
          unsubscribe();
          resolve();
        });
        router.history.go(distance, { ignoreBlocker: true });
      });
      if (JSON.stringify(previous.search) === JSON.stringify(nextSearch))
        return;
    }
    await navigate({
      to: previous.pathname,
      search: toUrlSearch(nextSearch),
      replace: distance >= 0,
      state: { houseScannerLayers: nextLayers },
      resetScroll: false,
    });
  }

  const updateSearch = useCallback(
    (patch: Partial<BrowseSearch>) => {
      void navigate({
        to: location.pathname,
        search: toUrlSearch({
          ...search,
          ...patch,
          ...(patch.filters ? { filterOpen: false } : {}),
        }),
        state: {
          houseScannerLayers: patch.filters
            ? { ...layers, filterOpen: undefined }
            : layers,
          houseScannerDetailOrigin: location.state.houseScannerDetailOrigin,
        },
        replace: Boolean(patch.filters && search.filterOpen),
        resetScroll: false,
      });
    },
    [
      location.pathname,
      location.state.houseScannerDetailOrigin,
      navigate,
      search,
      layers,
    ],
  );

  const closeLayer = (layer: Layer) => {
    const nextSearch = { ...search, [layer]: false };
    const nextLayers = { ...layers, [layer]: undefined };
    const previous = layers[layer];
    if (previous) void returnTo(previous, nextSearch, nextLayers);
    else
      void navigate({
        to: location.pathname,
        search: toUrlSearch(nextSearch),
        state: { houseScannerLayers: nextLayers },
        replace: true,
        resetScroll: false,
      });
  };
  const setLayer = (layer: Layer, open: boolean) => {
    if (!open) closeLayer(layer);
    else
      void navigate({
        to: location.pathname,
        search: toUrlSearch({ ...search, [layer]: true }),
        state: { houseScannerLayers: { ...layers, [layer]: origin() } },
        resetScroll: false,
      });
  };

  useEffect(
    () =>
      router.history.subscribe(({ action, location: next }) => {
        if (
          (action.type === 'BACK' || action.type === 'GO') &&
          search.select &&
          !listingId &&
          !search.filterOpen &&
          validateBrowseSearch(router.parseLocation(next).search).select
        ) {
          // Back closes selection before restoring an earlier committed search.
          void navigate({
            to: next.pathname,
            search: toUrlSearch({ ...search, select: false }),
            state: { houseScannerLayers: { ...layers, select: undefined } },
            replace: true,
            resetScroll: false,
          });
        }
      }),
    [router, navigate, search, listingId, layers],
  );

  const changeTab = (value: WorkspaceTab) => {
    void navigate({
      to: destinations[value],
      search: toUrlSearch({ ...search, select: false, filterOpen: false }),
      resetScroll: window.matchMedia('(max-width: 35.99375em)').matches,
    });
  };
  const openListing = (id: string) => {
    void navigate({
      to: '/shellter/listings/$listingId',
      params: { listingId: id },
      search: toUrlSearch({
        ...search,
        from: tab === 'favorites' || tab === 'viewings' ? tab : 'listings',
      }),
      state: { houseScannerDetailOrigin: origin(), houseScannerLayers: layers },
      resetScroll: false,
    });
  };
  const closeListing = () => {
    const previous = location.state.houseScannerDetailOrigin;
    if (previous) void returnTo(previous, previous.search);
    else
      void navigate({
        to: destinations[
          tab === 'favorites' || tab === 'viewings' ? tab : 'suggestions'
        ],
        search: toUrlSearch({ ...search, from: 'listings' }),
        replace: true,
        resetScroll: false,
      });
  };
  const seeSelectedOnMap = () => {
    void navigate({
      to: destinations[
        tab === 'favorites' || tab === 'viewings' ? 'favorites' : 'suggestions'
      ],
      search: toUrlSearch({
        ...search,
        view: 'map',
        // Viewings ignores browse filters and duplicate folding, so its map must include the same homes.
        filters:
          tab === 'viewings'
            ? { ...emptyFilters, showDuplicates: true }
            : search.filters,
      }),
      state: { houseScannerLayers: layers },
      resetScroll: false,
    });
  };
  return {
    search,
    tab,
    listingId,
    updateSearch,
    setLayer,
    changeTab,
    openListing,
    closeListing,
    seeSelectedOnMap,
  };
}
