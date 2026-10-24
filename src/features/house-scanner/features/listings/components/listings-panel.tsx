import {
  ActionIcon,
  Anchor,
  Button,
  Drawer,
  Flex,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Info } from 'lucide-react';
import {
  Component,
  type Dispatch,
  lazy,
  type ReactNode,
  type SetStateAction,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { ListingCard } from '@/features/house-scanner/components/listing-card';
import { ListingDrawer } from '@/features/house-scanner/components/listing-drawer';
import { ListingFilterPanel } from '@/features/house-scanner/features/listings/components/listing-filter-panel';
import { ScrollToTop } from '@/features/house-scanner/features/listings/features/list/components/scroll-to-top';
import { useListBatching } from '@/features/house-scanner/features/listings/features/list/hooks/use-list-batching';
import type { ListingSort } from '@/features/house-scanner/features/listings/features/list/utils/listing-sort';
import type { MapCameraState } from '@/features/house-scanner/features/listings/features/map/components/household-map';
import { MapSelectionReview } from '@/features/house-scanner/features/listings/features/map/components/map-selection-review';
import { MapStackSelection } from '@/features/house-scanner/features/listings/features/map/components/map-stack-selection';
import { PinCard } from '@/features/house-scanner/features/listings/features/map/components/pin-card';
import { reviewMapSelection } from '@/features/house-scanner/features/listings/features/map/utils/map-selection';
import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
import {
  type Feedback,
  formatFeedback,
  messageValue,
} from '@/features/house-scanner/i18n/catalogs';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type {
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import {
  activeFilterCount,
  applyListingFilters,
  emptyFilters,
  type ListingFilters,
} from '@/features/house-scanner/utils/listing-filters';
import { listingNeighborhoods } from '@/features/house-scanner/utils/listing-neighborhoods';
import { hasPin } from '@/features/house-scanner/utils/listing-position';
import { mapPoints } from '@/features/house-scanner/utils/listing-view';
import { loadMapRuntime } from '@/features/house-scanner/utils/map-runtime';
import { MATCH_CHOICES } from '@/features/house-scanner/utils/match-listing';

const LazyMap = lazy(() =>
  loadMapRuntime()
    .then(
      () =>
        import(
          '@/features/house-scanner/features/listings/features/map/components/household-map'
        ),
    )
    .then((module) => ({
      default: module.HouseholdMap,
    })),
);

class MapLoadBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <Text role="alert">
        <FormattedMessage id="listings.list.theMapCouldNotLoadUseTheListingControls" />
      </Text>
    ) : (
      this.props.children
    );
  }
}

interface ListingsPanelProps {
  tab: 'suggestions' | 'favorites';
  snapshot: Snapshot;
  userId: string;
  mapStyleUrl?: string;
  person: string;
  onPersonChange: (person: string) => void;
  section: string;
  onSectionChange: (section: string) => void;
  filters: ListingFilters;
  // The household's hidden homes, which stay out of view unless the filter says otherwise.
  hiddenIds: ReadonlySet<string>;
  // How many hidden homes the current filters keep out of view.
  hiddenCount: number;
  // How many cross-posted copies the current filters keep out of view.
  duplicateCount: number;
  // For a home that stays visible: the other sites carrying it.
  alsoOn: ReadonlyMap<string, string[]>;
  onHide: (listingId: string) => void;
  onUnhide: (listingId: string) => void;
  onHideMany: (ids: string[]) => Promise<boolean>;
  onUndoHide: () => Promise<boolean>;
  hideBusy: boolean;
  hideError: Feedback;
  hideMessage: Feedback;
  undoHideCount: number;
  canHide: boolean;
  // Set for an owner alone in the household: the empty Favorites tab offers to invite someone.
  onInvite?: () => void;
  selecting: boolean;
  onSelectingChange: (value: boolean) => void;
  filtersOpen: boolean;
  onFiltersOpenChange: (value: boolean) => void;
  sort: ListingSort;
  onSortChange: (value: ListingSort) => void;
  onFiltersChange: (filters: ListingFilters) => void;
  filterHosts: string[];
  // How many homes the tab holds before the filters apply.
  total: number;
  visible: Listing[];
  scoped: Listing[];
  duplicateIds: ReadonlySet<string>;
  selected: Listing | null;
  selectedId: string | null;
  onSelectedIdChange: Dispatch<SetStateAction<string | null>>;
  // The details sheet is open for the selected home.
  detailsOpen: boolean;
  onOpenListing: (id: string) => void;
  onCloseListing: () => void;
  onSeeSelectedOnMap: () => void;
  view: 'list' | 'map';
  onViewChange: (view: 'list' | 'map') => void;
  satellite: boolean;
  onSatelliteChange: (satellite: boolean) => void;
  pending: string[];
  mapWarning?: string;
  canSave: (listingId: string) => boolean;
  notes: ListingNotesController;
  onFavorite: (listingId: string) => Promise<void>;
  onSaveMany?: (ids: string[]) => Promise<boolean>;
  saveBusy?: boolean;
}

export function ListingsPanel({
  tab,
  snapshot,
  userId,
  mapStyleUrl,
  person,
  onPersonChange,
  section,
  onSectionChange,
  filters,
  hiddenIds,
  hiddenCount,
  duplicateCount,
  alsoOn,
  onHide,
  onUnhide,
  onHideMany,
  onUndoHide,
  hideBusy,
  hideError,
  hideMessage,
  undoHideCount,
  canHide,
  onInvite,
  selecting,
  onSelectingChange,
  filtersOpen,
  onFiltersOpenChange,
  sort,
  onSortChange,
  onFiltersChange,
  filterHosts,
  total,
  visible,
  scoped,
  duplicateIds,
  selected,
  selectedId,
  onSelectedIdChange,
  detailsOpen,
  onOpenListing,
  onCloseListing,
  onSeeSelectedOnMap,
  view,
  onViewChange,
  satellite,
  onSatelliteChange,
  pending,
  mapWarning,
  canSave,
  notes,
  onFavorite,
  onSaveMany,
  saveBusy = false,
}: ListingsPanelProps) {
  const intl = useIntl();

  const mobile = useMediaQuery('(max-width: 36em)');
  const mobileMap = mobile && view === 'map';
  const shell = useRef<HTMLElement>(null);
  const mapViewButton = useRef<HTMLButtonElement>(null);
  const previousMobileMap = useRef(mobileMap);
  useEffect(() => {
    const wasMobileMap = previousMobileMap.current;
    previousMobileMap.current = mobileMap;
    if (wasMobileMap && !mobileMap && !detailsOpen && !filtersOpen)
      mapViewButton.current?.focus({ preventScroll: true });
  }, [mobileMap, detailsOpen, filtersOpen]);
  useEffect(() => {
    if (!mobileMap || !shell.current) return;
    // Covered page controls must also be unavailable to keyboard users.
    const background: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = shell.current;
    while (branch.parentElement && branch.parentElement !== document.body) {
      for (const sibling of branch.parentElement.children) {
        if (sibling instanceof HTMLElement && sibling !== branch) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    shell.current.focus({ preventScroll: true });
    return () => {
      for (const { element, inert } of background) element.inert = inert;
    };
  }, [mobileMap]);
  const [draft, setDraft] = useState(filters);
  const [mapCardLayout, setMapCardLayout] = useState<'classic' | 'photo'>(
    'classic',
  );
  const [selection, setSelection] = useState<string[]>([]);
  const stackReturnFocus = useRef<HTMLElement | null>(null);
  const [stackReview, setStackReview] = useState<{
    tab: typeof tab;
    ids: string[];
  } | null>(null);
  const stackReviewIds = stackReview?.tab === tab ? stackReview.ids : [];
  const batchBusy = hideBusy || saveBusy;
  const canSelect = canHide || Boolean(onSaveMany);
  const [mapReview, setMapReview] = useState<{
    tab: typeof tab;
    ids: string[];
  } | null>(null);
  const camera = useRef<MapCameraState | null>(null);
  const mounted = useRef(false);
  const selectionContext = useRef({ tab, selecting });
  if (
    selectionContext.current.tab !== tab ||
    selectionContext.current.selecting !== selecting
  )
    selectionContext.current = { tab, selecting };
  const closeSelection = useRef(onSelectingChange);
  useEffect(() => {
    if (
      stackReview &&
      (!selecting || view !== 'map' || stackReview.tab !== tab)
    )
      setStackReview(null);
  }, [stackReview, selecting, view, tab]);
  closeSelection.current = onSelectingChange;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const eligible = useMemo(
    () =>
      new Set(
        visible
          .filter((listing) => !hiddenIds.has(listing.id))
          .map((listing) => listing.id),
      ),
    [visible, hiddenIds],
  );
  const checkedIds = selection.filter((id) => eligible.has(id));
  const checkedSet = useMemo(() => new Set(checkedIds), [checkedIds]);
  const savedIds = useMemo(
    () => new Set(snapshot.favorites.map((favorite) => favorite.listingId)),
    [snapshot.favorites],
  );
  const mine = new Set(
    snapshot.favorites
      .filter((entry) => entry.userId === userId)
      .map((entry) => entry.listingId),
  );
  const saveIds = checkedIds.filter((id) => !mine.has(id));
  const selectedFavoritePending = pending.some((id) => checkedSet.has(id));
  const unsavedIds = [...eligible].filter((id) => !savedIds.has(id));
  const savedCount = checkedIds.filter((id) => savedIds.has(id)).length;
  useEffect(() => {
    setSelection((ids) => {
      const next = selecting ? ids.filter((id) => eligible.has(id)) : [];
      return next.length === ids.length ? ids : next;
    });
  }, [eligible, selecting]);
  useEffect(() => {
    if (mapReview && (!selecting || view !== 'map' || mapReview.tab !== tab))
      setMapReview(null);
  }, [mapReview, tab, selecting, view]);
  useEffect(() => {
    if (!filtersOpen) setDraft(filters);
  }, [filters, filtersOpen]);
  const draftCount = useMemo(
    () =>
      applyListingFilters(
        scoped,
        tab === 'favorites' ? { ...draft, hidden: 'both' } : draft,
        hiddenIds,
        duplicateIds,
      ).length,
    [scoped, draft, hiddenIds, duplicateIds, tab],
  );
  const { ordered, renderedCount, listEnd } = useListBatching(
    visible,
    sort,
    view,
  );
  const toggleSelection = useCallback(
    (id: string) => {
      if (batchBusy || !eligible.has(id)) return;
      setSelection((ids) =>
        ids.includes(id)
          ? ids.filter((value) => value !== id)
          : ids.length < 500
            ? [...ids, id]
            : ids,
      );
    },
    [batchBusy, eligible],
  );
  async function hideSelected(ids = checkedIds) {
    const context = selectionContext.current;
    if (await onHideMany(ids)) {
      if (
        !mounted.current ||
        selectionContext.current !== context ||
        !context.selecting
      )
        return;
      setSelection([]);
      setMapReview(null);
      closeSelection.current(false);
    }
  }
  async function saveSelected() {
    if (!onSaveMany || batchBusy || selectedFavoritePending || !saveIds.length)
      return;
    const context = selectionContext.current;
    // Feedback belongs to the workspace; only selection changes depend on this tab/layer.
    if (await onSaveMany(checkedIds)) {
      if (!mounted.current || selectionContext.current !== context) return;
      setSelection([]);
      closeSelection.current(false);
    }
  }
  const selectMapListing = useCallback(
    (id: string) => {
      onSelectedIdChange(id);
      if (selecting) toggleSelection(id);
    },
    [onSelectedIdChange, selecting, toggleSelection],
  );
  const filtersActive = activeFilterCount(filters);
  const points = useMemo(
    () => mapPoints(visible, hiddenIds, snapshot.favorites, userId, intl),
    [visible, hiddenIds, snapshot.favorites, userId, intl],
  );
  // One handler per action, shared by every card, so unchanged cards skip rendering.
  // The favorite handler is rebuilt on every render, so the latest one is read through a ref.
  const favorite = useRef(onFavorite);
  favorite.current = onFavorite;
  const openListing = useRef(onOpenListing);
  openListing.current = onOpenListing;
  const selectListing = useCallback(
    (listingId: string) => openListing.current(listingId),
    [],
  );
  const showOnMap = useCallback(
    (listingId: string) => {
      onSelectedIdChange(listingId);
      onViewChange('map');
    },
    [onSelectedIdChange, onViewChange],
  );
  const hiddenRef = useRef(hiddenIds);
  hiddenRef.current = hiddenIds;
  const toggleHidden = useCallback(
    (listingId: string) =>
      hiddenRef.current.has(listingId)
        ? onUnhide(listingId)
        : onHide(listingId),
    [onHide, onUnhide],
  );
  const favoriteListing = useCallback(
    (listingId: string) => void favorite.current(listingId),
    [],
  );
  const selectedFavorite = {
    mine: selected
      ? snapshot.favorites.some(
          (entry) => entry.listingId === selected.id && entry.userId === userId,
        )
      : false,
    others: selected
      ? snapshot.favorites.some((entry) => entry.listingId === selected.id)
      : false,
    canSave: selected ? canSave(selected.id) : false,
    busy: saveBusy || (selected ? pending.includes(selected.id) : false),
  };
  const notLocated = visible.filter(
    (listing) => !hasPin(listing.coordinates),
  ).length;
  const reviewListings =
    mapReview === null
      ? []
      : reviewMapSelection(visible, mapReview.ids, hiddenIds);
  return (
    <section
      ref={shell}
      className={mobileMap ? classes.mobileMapShell : classes.listingsPanel}
      tabIndex={mobileMap ? -1 : undefined}
      aria-label={
        mobileMap
          ? intl.formatMessage({ id: 'listings.list.mapBrowsing' })
          : intl.formatMessage({ id: 'listings.list.listingResults' })
      }
    >
      {/* Stays in the accessibility tree while the active tab already names the view. */}
      <VisuallyHidden renderRoot={(props) => <Title order={2} {...props} />}>
        {tab === 'favorites'
          ? intl.formatMessage({ id: 'listings.list.favorites' })
          : intl.formatMessage({ id: 'listings.list.listings' })}
      </VisuallyHidden>
      {mobileMap && (
        <header className={classes.mobileMapHeader}>
          <Group gap="xs" wrap="wrap">
            <Button variant="default" onClick={() => onViewChange('list')}>
              <FormattedMessage id="listings.list.list" />
            </Button>
            <Button
              variant="default"
              aria-expanded={filtersOpen}
              aria-controls="listing-filters"
              onClick={() => {
                setDraft(filters);
                onFiltersOpenChange(true);
              }}
            >
              <FormattedMessage
                id="listings.list.filters"
                values={{
                  value0: messageValue(
                    filtersActive > 0 ? ` (${filtersActive})` : '',
                  ),
                }}
              />
            </Button>
            {canSelect && (
              <Button
                variant="default"
                disabled={batchBusy}
                onClick={() => onSelectingChange(!selecting)}
              >
                {selecting
                  ? intl.formatMessage({ id: 'common.cancel' })
                  : intl.formatMessage({ id: 'common.select' })}
              </Button>
            )}
          </Group>
          <Text size="sm" c="dimmed" role="status">
            <FormattedMessage
              id="listings.list.homes"
              values={{
                value0: messageValue(visible.length),
                value1: messageValue(
                  hiddenCount > 0 &&
                    intl.formatMessage(
                      { id: 'listings.list.hidden' },
                      { value0: messageValue(hiddenCount) },
                    ),
                ),
                value2: messageValue(
                  duplicateCount > 0 &&
                    intl.formatMessage(
                      { id: 'listings.list.duplicatesFolded' },
                      { value0: messageValue(duplicateCount) },
                    ),
                ),
              }}
            />
          </Text>
          {mapWarning && (
            <Text size="sm" c="red.8" role="status">
              {mapWarning}
            </Text>
          )}
        </header>
      )}
      {!mobileMap && (
        <div className={classes.toolbar}>
          <Flex
            gap="sm"
            align="flex-end"
            wrap="wrap"
            className={classes.toolbarControls}
          >
            {tab === 'favorites' && (
              <Select
                label={intl.formatMessage({ id: 'listings.list.savedBy' })}
                w={{ base: 140, sm: 200 }}
                value={person}
                onChange={(value) => onPersonChange(value ?? 'everyone')}
                data={[
                  {
                    value: 'everyone',
                    label: intl.formatMessage({ id: 'listings.list.everyone' }),
                  },
                  {
                    value: 'mine',
                    label: intl.formatMessage({ id: 'listings.list.mine' }),
                  },
                  ...snapshot.members.map((entry) => ({
                    value: entry.userId,
                    label: entry.displayName,
                  })),
                ]}
              />
            )}
            <div className={classes.toolbarSortControls}>
              <Select
                label={intl.formatMessage({ id: 'listings.list.sort' })}
                aria-label={intl.formatMessage({
                  id: 'listings.list.sortHomes',
                })}
                value={sort}
                onChange={(value) =>
                  onSortChange((value as ListingSort) ?? 'newest')
                }
                data={[
                  {
                    value: 'newest',
                    label: intl.formatMessage({ id: 'listings.list.newest' }),
                  },
                  {
                    value: 'oldest',
                    label: intl.formatMessage({ id: 'listings.list.oldest' }),
                  },
                  {
                    value: 'next-viewing',
                    label: intl.formatMessage({
                      id: 'listings.list.nextViewing',
                    }),
                  },
                  {
                    value: 'alphabetical',
                    label: intl.formatMessage({
                      id: 'listings.list.alphabetical',
                    }),
                  },
                  {
                    value: 'price-asc',
                    label: intl.formatMessage({
                      id: 'listings.list.priceLowToHigh',
                    }),
                  },
                  {
                    value: 'price-desc',
                    label: intl.formatMessage({
                      id: 'listings.list.priceHighToLow',
                    }),
                  },
                ]}
                w={{ base: 140, sm: 180 }}
              />
              <Button
                variant="default"
                aria-expanded={filtersOpen}
                aria-controls="listing-filters"
                onClick={() => {
                  setDraft(filters);
                  onFiltersOpenChange(true);
                }}
              >
                <FormattedMessage
                  id="listings.list.filters"
                  values={{
                    value0: messageValue(
                      filtersActive > 0 ? ` (${filtersActive})` : '',
                    ),
                  }}
                />
              </Button>
            </div>
          </Flex>
          <TextInput
            type="search"
            label={intl.formatMessage({ id: 'listings.list.searchByTitle' })}
            placeholder={intl.formatMessage({
              id: 'listings.list.streetOrListingTitle',
            })}
            value={filters.titleQuery}
            maxLength={128}
            onChange={(event) =>
              onFiltersChange({
                ...filters,
                titleQuery: event.currentTarget.value,
              })
            }
            className={classes.toolbarSearch}
            w={{ base: '100%', sm: 220 }}
            maw="100%"
          />
          <Group
            gap="sm"
            justify="space-between"
            wrap="wrap"
            className={classes.toolbarView}
          >
            <Text size="sm" c="dimmed">
              {visible.length} <FormattedMessage id="listings.list.homes2" />
              {notLocated > 0 &&
                intl.formatMessage(
                  { id: 'listings.list.notLocated' },
                  { value0: messageValue(notLocated) },
                )}
              {hiddenCount > 0 &&
                intl.formatMessage(
                  { id: 'listings.list.hidden' },
                  { value0: messageValue(hiddenCount) },
                )}
              {duplicateCount > 0 &&
                intl.formatMessage(
                  { id: 'listings.list.duplicatesFolded' },
                  { value0: messageValue(duplicateCount) },
                )}
              {filtersActive > 0 && (
                <>
                  {' · '}
                  <Anchor
                    component="button"
                    type="button"
                    size="sm"
                    onClick={() => onFiltersChange(emptyFilters)}
                  >
                    <FormattedMessage id="listings.list.clearAllFilters" />
                  </Anchor>
                </>
              )}
            </Text>
            <Group gap="xs" wrap="wrap">
              <Group
                gap="xs"
                role="group"
                aria-label={intl.formatMessage({ id: 'listings.list.view' })}
              >
                <Button
                  variant={view === 'list' ? 'filled' : 'default'}
                  aria-pressed={view === 'list'}
                  onClick={() => onViewChange('list')}
                >
                  <FormattedMessage id="listings.list.list" />
                </Button>
                <Button
                  ref={mapViewButton}
                  variant={view === 'map' ? 'filled' : 'default'}
                  aria-pressed={view === 'map'}
                  onClick={() => onViewChange('map')}
                >
                  <FormattedMessage id="listings.list.map" />
                </Button>
              </Group>
              {canSelect && (
                <Button
                  variant="default"
                  disabled={batchBusy}
                  onClick={() => onSelectingChange(!selecting)}
                >
                  {selecting
                    ? intl.formatMessage({
                        id: 'listings.list.cancelSelection',
                      })
                    : intl.formatMessage({ id: 'common.select' })}
                </Button>
              )}
            </Group>
          </Group>
        </div>
      )}
      <Drawer
        opened={filtersOpen}
        onClose={() => onFiltersOpenChange(false)}
        title={intl.formatMessage({ id: 'listings.list.filters2' })}
        position="right"
        size="md"
        closeButtonProps={{
          'aria-label': intl.formatMessage({
            id: 'listings.list.closeFilters',
          }),
        }}
      >
        <Stack>
          <ListingFilterPanel
            open={filtersOpen}
            filters={draft}
            onChange={setDraft}
            hosts={filterHosts}
            shown={draftCount}
            total={total}
            match={
              tab === 'favorites' ? null : (
                <Stack gap={4} flex="1 1 15rem">
                  <Group gap={4} wrap="nowrap">
                    <Text size="sm" fw={500}>
                      <FormattedMessage id="listings.list.match" />
                    </Text>
                    <Tooltip
                      multiline
                      w={300}
                      events={{ hover: true, focus: true, touch: true }}
                      label={
                        <Stack gap={4}>
                          {MATCH_CHOICES(intl).map(
                            ({ value, label, description }) => (
                              <Text key={value} size="xs">
                                {label}: {description}
                              </Text>
                            ),
                          )}
                        </Stack>
                      }
                    >
                      <ActionIcon
                        variant="transparent"
                        color="gray"
                        size="sm"
                        className={`${classes.matchHelp} ${classes.inlineHelp}`}
                        aria-label={intl.formatMessage({
                          id: 'listings.list.whatTheMatchOptionsMean',
                        })}
                      >
                        <Info size={16} aria-hidden />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                  <Select
                    aria-label={intl.formatMessage({
                      id: 'listings.list.match',
                    })}
                    value={section}
                    onChange={(value) => onSectionChange(value ?? 'all')}
                    data={[
                      {
                        value: 'all',
                        label: intl.formatMessage({ id: 'listings.list.all' }),
                      },
                      ...MATCH_CHOICES(intl).map(({ value, label }) => ({
                        value,
                        label,
                      })),
                    ]}
                  />
                </Stack>
              )
            }
            unassignedNeighborhoodCount={
              scoped.filter(
                (listing) => listingNeighborhoods(listing).length === 0,
              ).length
            }
          />
          <Group
            justify="space-between"
            pos="sticky"
            bottom={0}
            p={16}
            bg="var(--shellter-surface)"
            style={{
              borderTop: '1px solid var(--mantine-color-default-border)',
            }}
          >
            <Button
              variant="default"
              onClick={() => onFiltersOpenChange(false)}
            >
              <FormattedMessage id="common.cancel" />
            </Button>
            <Button onClick={() => onFiltersChange(draft)}>
              <FormattedMessage
                id="listings.list.showHomes"
                values={{ value0: messageValue(draftCount) }}
              />
            </Button>
          </Group>
        </Stack>
      </Drawer>
      {selecting && (
        <Stack
          gap="xs"
          className={mobileMap ? classes.mobileMapStatus : undefined}
        >
          <Text role="status" aria-live="polite">
            <FormattedMessage
              id="listings.list.selectedSavesAreYoursHidingIsForTheHousehold"
              values={{
                value0: messageValue(checkedIds.length),
                value1: messageValue(
                  savedCount > 0
                    ? intl.formatMessage(
                        { id: 'listings.list.includesSavedCount' },
                        { count: savedCount },
                      )
                    : '',
                ),
              }}
            />
          </Text>
          <Group gap="xs">
            {view === 'list' && (
              <Button
                variant="subtle"
                className={classes.batchSelect}
                disabled={batchBusy || unsavedIds.length === 0}
                onClick={() => setSelection(unsavedIds.slice(0, 500))}
              >
                <FormattedMessage
                  id="listings.list.selectUnsaved"
                  values={{
                    value0: messageValue(Math.min(500, unsavedIds.length)),
                  }}
                />
              </Button>
            )}
            <Button
              variant="subtle"
              disabled={batchBusy || !checkedIds.length}
              onClick={() => setSelection([])}
            >
              <FormattedMessage id="listings.list.clearSelection" />
            </Button>
          </Group>
          {checkedIds.length === 500 && (
            <Text size="sm">
              <FormattedMessage id="listings.list.500HomeLimitReachedApplyThisBatchBeforeSelecting" />
            </Text>
          )}
          {view === 'map' && !mobileMap && (
            <Text size="sm">
              <FormattedMessage id="listings.list.tapPinsToSelectHomesAndSeeAPreview" />
            </Text>
          )}
        </Stack>
      )}
      {(hideError || undoHideCount > 0) && (
        <Group
          className={mobileMap ? classes.mobileMapStatus : undefined}
          role={hideError ? 'alert' : 'status'}
          aria-live="polite"
        >
          {hideError && (
            <Text size="sm">{formatFeedback(intl, hideError)}</Text>
          )}
          {!hideError && undoHideCount > 0 && hideMessage && (
            <Text size="sm">{formatFeedback(intl, hideMessage)}</Text>
          )}
          {undoHideCount > 0 && (
            <Button
              variant="default"
              disabled={batchBusy}
              onClick={() => void onUndoHide()}
            >
              <FormattedMessage
                id="listings.list.undoHide"
                values={{ value0: messageValue(undoHideCount) }}
              />
            </Button>
          )}
        </Group>
      )}
      {!total && tab === 'favorites' ? (
        <Stack align="flex-start" gap="xs">
          <Text>
            <FormattedMessage id="listings.list.favoritesEmpty" />
          </Text>
          {onInvite && (
            <Button variant="default" onClick={onInvite}>
              <FormattedMessage id="listings.list.inviteSomeone" />
            </Button>
          )}
        </Stack>
      ) : (
        !visible.length &&
        view === 'list' && (
          <Text>
            <FormattedMessage
              id="listings.list.noHomesHere"
              values={{
                value0: messageValue(
                  activeFilterCount(filters) > 0 &&
                    intl.formatMessage({
                      id: 'listings.list.clearTheFiltersToSeeMore',
                    }),
                ),
              }}
            />
          </Text>
        )
      )}
      {mobile && view === 'list' && <ScrollToTop />}
      {view === 'list' ? (
        <div className={classes.list}>
          {ordered.slice(0, renderedCount).map((listing) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              snapshot={snapshot}
              userId={userId}
              selected={selectedId === listing.id}
              selectionMode={selecting}
              checked={checkedSet.has(listing.id)}
              selectionDisabled={
                batchBusy ||
                hiddenIds.has(listing.id) ||
                (checkedIds.length >= 500 && !checkedSet.has(listing.id))
              }
              onToggleSelection={toggleSelection}
              busy={saveBusy || pending.includes(listing.id)}
              canSave={canSave(listing.id)}
              hidden={hiddenIds.has(listing.id)}
              alsoOn={alsoOn.get(listing.id)}
              onToggleHidden={canHide && !batchBusy ? toggleHidden : undefined}
              onSelect={selectListing}
              onSeeOnMap={showOnMap}
              onFavorite={favoriteListing}
            />
          ))}
          {renderedCount < ordered.length && (
            <div ref={listEnd} className={classes.listEnd} aria-hidden="true" />
          )}
        </div>
      ) : (
        <div className={classes.mapPanel}>
          {/* The same view the Hidden homes filter sets, so the list and the map stay in step. */}
          {!mobileMap && tab !== 'favorites' && (
            <Switch
              label={intl.formatMessage({
                id: 'listings.list.showHiddenHomes',
              })}
              checked={filters.hidden !== 'not-hidden'}
              onChange={(event) =>
                onFiltersChange({
                  ...filters,
                  hidden: event.currentTarget.checked ? 'both' : 'not-hidden',
                })
              }
            />
          )}
          {visible.length ? (
            <MapLoadBoundary>
              <Suspense
                fallback={
                  <Text role="status">
                    <FormattedMessage id="listings.list.loadingMap" />
                  </Text>
                }
              >
                <LazyMap
                  fillMobile
                  onCaptureView={
                    selecting && canHide
                      ? (ids) => setMapReview({ tab, ids })
                      : undefined
                  }
                  captureDisabled={batchBusy}
                  camera={camera}
                  styleUrl={mapStyleUrl}
                  satellite={satellite}
                  points={points}
                  controls={
                    <Stack gap="xs">
                      <Group
                        gap="xs"
                        role="group"
                        aria-label={intl.formatMessage({
                          id: 'listings.list.basemap',
                        })}
                      >
                        <Button
                          size="xs"
                          variant={satellite ? 'default' : 'filled'}
                          aria-pressed={!satellite}
                          onClick={() => onSatelliteChange(false)}
                        >
                          <FormattedMessage id="listings.list.streetMap" />
                        </Button>
                        <Button
                          size="xs"
                          variant={satellite ? 'filled' : 'default'}
                          aria-pressed={satellite}
                          onClick={() => onSatelliteChange(true)}
                        >
                          <FormattedMessage id="listings.list.satellite" />
                        </Button>
                      </Group>
                      <Group
                        gap="xs"
                        role="group"
                        aria-label={intl.formatMessage({
                          id: 'listings.map.cardLayout',
                        })}
                      >
                        {(['classic', 'photo'] as const).map((layout) => (
                          <Button
                            key={layout}
                            size="xs"
                            variant={
                              mapCardLayout === layout ? 'filled' : 'default'
                            }
                            aria-pressed={mapCardLayout === layout}
                            onClick={() => setMapCardLayout(layout)}
                          >
                            <FormattedMessage
                              id={`listings.map.${layout}Card`}
                            />
                          </Button>
                        ))}
                      </Group>
                    </Stack>
                  }
                  selectedId={selected?.id ?? null}
                  selectionMode={selecting}
                  checkedIds={checkedSet}
                  selectionDisabled={batchBusy}
                  onSelect={selectMapListing}
                  onPreview={onSelectedIdChange}
                  onOpenStack={(ids) => {
                    stackReturnFocus.current =
                      document.activeElement instanceof HTMLElement
                        ? document.activeElement
                        : null;
                    setStackReview({ tab, ids });
                  }}
                  onDeselect={() => onSelectedIdChange(null)}
                  overlay={
                    selected ? (
                      <PinCard
                        layout={mapCardLayout}
                        listing={selected}
                        favorite={selectedFavorite}
                        hidden={hiddenIds.has(selected.id)}
                        alsoOn={alsoOn.get(selected.id)}
                        selection={
                          selecting
                            ? {
                                checked: checkedSet.has(selected.id),
                                disabled:
                                  batchBusy ||
                                  !eligible.has(selected.id) ||
                                  (checkedIds.length >= 500 &&
                                    !checkedSet.has(selected.id)),
                                onToggle: () => toggleSelection(selected.id),
                              }
                            : undefined
                        }
                        onFavorite={favoriteListing}
                        onToggleHidden={(listingId) => {
                          toggleHidden(listingId);
                          // A home hidden out of the view takes its card with it, and stays closed when it returns.
                          if (
                            !hiddenIds.has(listingId) &&
                            filters.hidden === 'not-hidden' &&
                            tab !== 'favorites'
                          )
                            onSelectedIdChange(null);
                        }}
                        onClose={() => onSelectedIdChange(null)}
                        onDetails={() => onOpenListing(selected.id)}
                      />
                    ) : null
                  }
                />
              </Suspense>
            </MapLoadBoundary>
          ) : (
            <Text p="sm">
              <FormattedMessage id="listings.list.noHomesToShowChangeTheFiltersToSee" />
            </Text>
          )}
        </div>
      )}
      {selecting && (
        <Group className={classes.selectionBar} justify="space-between">
          <Text>
            <FormattedMessage
              id="listings.list.selected"
              values={{ value0: messageValue(checkedIds.length) }}
            />
          </Text>
          <Group gap="xs">
            {onSaveMany && (
              <Button
                disabled={
                  !saveIds.length || batchBusy || selectedFavoritePending
                }
                loading={saveBusy}
                onClick={() => void saveSelected()}
              >
                <FormattedMessage
                  id="listings.list.save"
                  values={{ value0: messageValue(saveIds.length) }}
                />
              </Button>
            )}
            {canHide && (
              <Button
                variant="default"
                disabled={checkedIds.length === 0 || batchBusy}
                loading={hideBusy}
                onClick={() => void hideSelected()}
              >
                <FormattedMessage
                  id="listings.list.hide"
                  values={{ value0: messageValue(checkedIds.length) }}
                />
              </Button>
            )}
          </Group>
        </Group>
      )}
      {selecting && view === 'map' && stackReviewIds.length > 0 && (
        <MapStackSelection
          listings={visible.filter(
            (listing) =>
              stackReviewIds.includes(listing.id) && eligible.has(listing.id),
          )}
          checkedIds={checkedSet}
          disabled={batchBusy}
          onToggle={selectMapListing}
          onDetails={(id) => {
            setStackReview(null);
            // Details must return to a live marker, not the chooser button being removed.
            queueMicrotask(() => {
              stackReturnFocus.current?.focus({ preventScroll: true });
              onOpenListing(id);
            });
          }}
          onClose={() => {
            setStackReview(null);
            queueMicrotask(() =>
              stackReturnFocus.current?.focus({ preventScroll: true }),
            );
          }}
        />
      )}
      {selecting && view === 'map' && mapReview !== null && (
        <MapSelectionReview
          listings={reviewListings}
          savedIds={savedIds}
          busy={batchBusy}
          error={formatFeedback(intl, hideError)}
          onClose={() => setMapReview(null)}
          onHide={(ids) => void hideSelected(ids)}
        />
      )}
      <ListingDrawer
        listing={selected}
        snapshot={snapshot}
        userId={userId}
        alsoOn={selected ? alsoOn.get(selected.id) : undefined}
        opened={detailsOpen && selected !== null}
        hidden={selected ? hiddenIds.has(selected.id) : false}
        favorite={selectedFavorite}
        notes={notes}
        onToggleHidden={toggleHidden}
        onFavorite={favoriteListing}
        onClose={onCloseListing}
        onSeeOnMap={onSeeSelectedOnMap}
        mapStyleUrl={mapStyleUrl}
      />
    </section>
  );
}
