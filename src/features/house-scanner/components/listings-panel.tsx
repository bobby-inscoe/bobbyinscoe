import {
  ActionIcon,
  Badge,
  Button,
  Drawer,
  Flex,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
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
import type { MapCameraState } from '@/features/house-scanner/components/household-map';
import styles from '@/features/house-scanner/components/household-workspace.module.css';
import { ListingCard } from '@/features/house-scanner/components/listing-card';
import { ListingDrawer } from '@/features/house-scanner/components/listing-drawer';
import { ListingFilterPanel } from '@/features/house-scanner/components/listing-filter-panel';
import { MapSelectionReview } from '@/features/house-scanner/components/map-selection-review';
import { MapStackSelection } from '@/features/house-scanner/components/map-stack-selection';
import { PinCard } from '@/features/house-scanner/components/pin-card';
import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
import type {
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import {
  activeFilterCount,
  applyListingFilters,
  type ListingFilters,
} from '@/features/house-scanner/utils/listing-filters';
import { listingNeighborhoods } from '@/features/house-scanner/utils/listing-neighborhoods';
import { hasPin } from '@/features/house-scanner/utils/listing-position';
import { isListingStale } from '@/features/house-scanner/utils/listing-staleness';
import { mapPoints } from '@/features/house-scanner/utils/listing-view';
import { reviewMapSelection } from '@/features/house-scanner/utils/map-selection';
import { MATCH_CHOICES } from '@/features/house-scanner/utils/match-listing';

const LazyMap = lazy(() =>
  import('@/features/house-scanner/components/household-map').then(
    (module) => ({
      default: module.HouseholdMap,
    }),
  ),
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
        The map could not load. Use the listing controls and details below.
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
  // This member's hidden homes, which stay out of view unless the filter says otherwise.
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
  hideError: string;
  hideMessage: string;
  undoHideCount: number;
  canHide: boolean;
  selecting: boolean;
  onSelectingChange: (value: boolean) => void;
  filtersOpen: boolean;
  onFiltersOpenChange: (value: boolean) => void;
  sort: 'default' | 'price-asc' | 'price-desc';
  onSortChange: (value: 'default' | 'price-asc' | 'price-desc') => void;
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
  favoriteMessage?: string;
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
  favoriteMessage,
  mapWarning,
  canSave,
  notes,
  onFavorite,
  onSaveMany,
  saveBusy = false,
}: ListingsPanelProps) {
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
    () => applyListingFilters(scoped, draft, hiddenIds, duplicateIds).length,
    [scoped, draft, hiddenIds, duplicateIds],
  );
  const ordered = useMemo(() => {
    if (sort === 'default') return visible;
    const price = (listing: Listing) =>
      listing.conflicts.includes('askingPriceSek')
        ? null
        : listing.facts.askingPriceSek;
    return [...visible].sort((a, b) => {
      const first = price(a);
      const second = price(b);
      if (first === null) return second === null ? 0 : 1;
      if (second === null) return -1;
      return sort === 'price-asc' ? first - second : second - first;
    });
  }, [visible, sort]);
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
    () => mapPoints(visible, hiddenIds, snapshot.favorites, userId),
    [visible, hiddenIds, snapshot.favorites, userId],
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
      className={mobileMap ? styles.mobileMapShell : styles.listingsPanel}
      tabIndex={mobileMap ? -1 : undefined}
      aria-label={mobileMap ? 'Map browsing' : 'Listing results'}
    >
      <Title order={2} className={styles.visuallyHidden}>
        {tab === 'favorites' ? 'Favorites' : 'Listings'}
      </Title>
      {mobileMap && (
        <header className={styles.mobileMapHeader}>
          <Group gap="xs" wrap="wrap">
            <Button variant="default" onClick={() => onViewChange('list')}>
              List
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
              Filters{filtersActive > 0 ? ` (${filtersActive})` : ''}
            </Button>
            {canSelect && (
              <Button
                variant="default"
                disabled={batchBusy}
                onClick={() => onSelectingChange(!selecting)}
              >
                {selecting ? 'Cancel' : 'Select'}
              </Button>
            )}
          </Group>
          <Text size="sm" c="dimmed" role="status">
            {visible.length} homes
            {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
            {duplicateCount > 0 && ` · ${duplicateCount} duplicates folded`}
          </Text>
          {mapWarning && (
            <Text size="sm" c="red.8" role="status">
              {mapWarning}
            </Text>
          )}
          {favoriteMessage && (
            <Text size="sm" role="status" aria-live="polite">
              {favoriteMessage}
            </Text>
          )}
        </header>
      )}
      {!mobileMap && (
        <div className={styles.toolbar}>
          <Flex
            gap="sm"
            align="flex-end"
            wrap="wrap"
            className={styles.toolbarControls}
          >
            {tab === 'favorites' ? (
              <Select
                label="Saved by"
                w={{ base: 140, sm: 200 }}
                value={person}
                onChange={(value) => onPersonChange(value ?? 'everyone')}
                data={[
                  { value: 'everyone', label: 'Everyone' },
                  { value: 'mine', label: 'Mine' },
                  ...snapshot.members.map((entry) => ({
                    value: entry.userId,
                    label: entry.displayName,
                  })),
                ]}
                comboboxProps={{ withinPortal: false }}
              />
            ) : (
              <Group gap="xs" align="flex-end" wrap="nowrap" maw="100%">
                <Select
                  label="Match"
                  w={{ base: 140, sm: 200 }}
                  style={{ flex: '1 1 auto', minWidth: 0 }}
                  value={section}
                  onChange={(value) => onSectionChange(value ?? 'all')}
                  data={[
                    { value: 'all', label: 'All' },
                    ...MATCH_CHOICES.map(({ value, label }) => ({
                      value,
                      label,
                    })),
                  ]}
                  comboboxProps={{ withinPortal: false }}
                />
                <Tooltip
                  multiline
                  w={300}
                  events={{ hover: true, focus: true, touch: true }}
                  label={
                    <Stack gap={4}>
                      {MATCH_CHOICES.map(({ value, label, description }) => (
                        <Text key={value} size="xs">
                          {label}: {description}
                        </Text>
                      ))}
                    </Stack>
                  }
                >
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="lg"
                    aria-label="What the match options mean"
                  >
                    ⓘ
                  </ActionIcon>
                </Tooltip>
              </Group>
            )}
            <Group gap="xs">
              <Button
                variant="default"
                aria-expanded={filtersOpen}
                aria-controls="listing-filters"
                onClick={() => {
                  setDraft(filters);
                  onFiltersOpenChange(true);
                }}
              >
                Filters
              </Button>
              {filtersActive > 0 && (
                <Badge
                  variant="light"
                  color="gray"
                  aria-label={`${filtersActive} active filters`}
                >
                  {filtersActive} active
                </Badge>
              )}
            </Group>
          </Flex>
          <Group
            gap="sm"
            justify="space-between"
            wrap="wrap"
            className={styles.toolbarView}
          >
            <Text size="sm" c="dimmed">
              {visible.length} homes
              {notLocated > 0 && ` · ${notLocated} not located`}
              {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
              {duplicateCount > 0 && ` · ${duplicateCount} duplicates folded`}
            </Text>
            <Group gap="xs" role="group" aria-label="View">
              <Button
                variant={view === 'list' ? 'filled' : 'default'}
                aria-pressed={view === 'list'}
                onClick={() => onViewChange('list')}
              >
                List
              </Button>
              <Button
                ref={mapViewButton}
                variant={view === 'map' ? 'filled' : 'default'}
                aria-pressed={view === 'map'}
                onClick={() => onViewChange('map')}
              >
                Map
              </Button>
            </Group>
          </Group>
        </div>
      )}
      <Drawer
        opened={filtersOpen}
        onClose={() => onFiltersOpenChange(false)}
        title="Filters"
        position="right"
        size="md"
        classNames={{ root: `${styles.scope} ${styles.touch}` }}
        closeButtonProps={{ 'aria-label': 'Close filters' }}
      >
        <Stack>
          <ListingFilterPanel
            open={filtersOpen}
            filters={draft}
            onChange={setDraft}
            hosts={filterHosts}
            shown={draftCount}
            total={total}
            unassignedNeighborhoodCount={
              scoped.filter(
                (listing) => listingNeighborhoods(listing).length === 0,
              ).length
            }
          />
          <Group
            justify="space-between"
            style={{
              position: 'sticky',
              bottom: 0,
              paddingBlock: 12,
              background: 'var(--scanner-surface)',
            }}
          >
            <Button
              variant="default"
              onClick={() => onFiltersOpenChange(false)}
            >
              Cancel
            </Button>
            <Button onClick={() => onFiltersChange(draft)}>
              Show {draftCount} homes
            </Button>
          </Group>
        </Stack>
      </Drawer>
      {!mobileMap && (
        <Group justify="space-between" gap="xs">
          <Select
            aria-label="Sort homes"
            value={sort}
            onChange={(value) =>
              onSortChange(
                value === 'price-asc' || value === 'price-desc'
                  ? value
                  : 'default',
              )
            }
            data={[
              { value: 'default', label: 'Current order' },
              { value: 'price-asc', label: 'Price: low to high' },
              { value: 'price-desc', label: 'Price: high to low' },
            ]}
            w={{ base: 170, sm: 200 }}
            maw="100%"
          />
          {canSelect && (
            <Button
              variant="default"
              disabled={batchBusy}
              onClick={() => onSelectingChange(!selecting)}
            >
              {selecting ? 'Cancel selection' : 'Select'}
            </Button>
          )}
        </Group>
      )}
      {selecting && (
        <Stack
          gap="xs"
          className={mobileMap ? styles.mobileMapStatus : undefined}
        >
          <Text role="status" aria-live="polite">
            {checkedIds.length} selected · Saves are yours; hiding is only for
            you
            {savedCount > 0
              ? ` · Includes ${savedCount} saved ${savedCount === 1 ? 'home' : 'homes'}`
              : ''}
          </Text>
          <Group gap="xs">
            {view === 'list' && (
              <Button
                variant="subtle"
                className={styles.batchSelect}
                disabled={batchBusy || unsavedIds.length === 0}
                onClick={() => setSelection(unsavedIds.slice(0, 500))}
              >
                Select unsaved ({Math.min(500, unsavedIds.length)})
              </Button>
            )}
            <Button
              variant="subtle"
              disabled={batchBusy || !checkedIds.length}
              onClick={() => setSelection([])}
            >
              Clear selection
            </Button>
          </Group>
          {checkedIds.length === 500 && (
            <Text size="sm">
              500-home limit reached. Apply this batch before selecting more.
            </Text>
          )}
          {view === 'map' && !mobileMap && (
            <Text size="sm">
              Tap pins to select homes and see a preview. Use Review this area
              for a larger batch.
            </Text>
          )}
        </Stack>
      )}
      {(hideError || hideMessage) && (
        <Group
          className={mobileMap ? styles.mobileMapStatus : undefined}
          role={hideError ? 'alert' : 'status'}
          aria-live="polite"
        >
          <Text size="sm">{hideError || hideMessage}</Text>
          {undoHideCount > 0 && (
            <Button
              variant="default"
              disabled={batchBusy}
              onClick={() => void onUndoHide()}
            >
              Undo hide ({undoHideCount})
            </Button>
          )}
        </Group>
      )}
      {!visible.length && view === 'list' && (
        <Text>
          No homes here.
          {activeFilterCount(filters) > 0 && ' Clear the filters to see more.'}
        </Text>
      )}
      {view === 'list' ? (
        <div className={styles.list}>
          {ordered.map((listing) => (
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
              stale={isListingStale(listing, snapshot.edition)}
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
        </div>
      ) : (
        <div className={styles.mapPanel}>
          {/* The same view the Hidden homes filter sets, so the list and the map stay in step. */}
          {!mobileMap && (
            <Switch
              label="Show hidden homes"
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
              <Suspense fallback={<Text role="status">Loading map…</Text>}>
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
                    <Group gap="xs" role="group" aria-label="Basemap">
                      <Button
                        size="xs"
                        variant={satellite ? 'default' : 'filled'}
                        aria-pressed={!satellite}
                        onClick={() => onSatelliteChange(false)}
                      >
                        Street map
                      </Button>
                      <Button
                        size="xs"
                        variant={satellite ? 'filled' : 'default'}
                        aria-pressed={satellite}
                        onClick={() => onSatelliteChange(true)}
                      >
                        Satellite
                      </Button>
                    </Group>
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
                            filters.hidden === 'not-hidden'
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
              No homes to show. Change the filters to see more.
            </Text>
          )}
        </div>
      )}
      {selecting && (
        <Group className={styles.selectionBar} justify="space-between">
          <Text>{checkedIds.length} selected</Text>
          <Group gap="xs">
            {onSaveMany && (
              <Button
                disabled={
                  !saveIds.length || batchBusy || selectedFavoritePending
                }
                loading={saveBusy}
                onClick={() => void saveSelected()}
              >
                Save {saveIds.length}
              </Button>
            )}
            {canHide && (
              <Button
                variant="default"
                disabled={checkedIds.length === 0 || batchBusy}
                loading={hideBusy}
                onClick={() => void hideSelected()}
              >
                Hide {checkedIds.length}
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
          error={hideError}
          onClose={() => setMapReview(null)}
          onHide={(ids) => void hideSelected(ids)}
        />
      )}
      <ListingDrawer
        backLabel={
          tab === 'favorites' ? 'Back to favorites' : 'Back to listings'
        }
        listing={selected}
        snapshot={snapshot}
        userId={userId}
        alsoOn={selected ? alsoOn.get(selected.id) : undefined}
        opened={detailsOpen && selected !== null}
        stale={selected ? isListingStale(selected, snapshot.edition) : false}
        hidden={selected ? hiddenIds.has(selected.id) : false}
        favorite={selectedFavorite}
        notes={notes}
        onToggleHidden={toggleHidden}
        onFavorite={favoriteListing}
        onClose={onCloseListing}
        onSeeOnMap={onSeeSelectedOnMap}
      />
    </section>
  );
}
