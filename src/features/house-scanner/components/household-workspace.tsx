import { Badge, Button, Group, Menu, Text } from '@mantine/core';
import { CalendarDays, Ellipsis, House, Star } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';

import { AddLinkPanel } from '@/features/house-scanner/components/add-link-panel';
import { ListingsPanel } from '@/features/house-scanner/components/listings-panel';
import { ManualActionsProvider } from '@/features/house-scanner/components/manual-listing-actions';
import { PriceEstimateProvider } from '@/features/house-scanner/components/price-estimate';
import { SettingsPanel } from '@/features/house-scanner/components/settings-panel';
import {
  favoriteViewings,
  ViewingsPanel,
} from '@/features/house-scanner/components/viewings-panel';
import { useBrowseNavigation } from '@/features/house-scanner/hooks/use-browse-navigation';
import { useFavoriteToggle } from '@/features/house-scanner/hooks/use-favorite-toggle';
import { useHiddenListings } from '@/features/house-scanner/hooks/use-hidden-listings';
import { useListingNotes } from '@/features/house-scanner/hooks/use-listing-notes';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type { Snapshot } from '@/features/house-scanner/types/contracts';
import type {
  HouseholdAccessActions,
  HouseholdActions,
} from '@/features/house-scanner/types/household';
import { validateBrowseSearch } from '@/features/house-scanner/utils/browse-search';
import { findDuplicates } from '@/features/house-scanner/utils/duplicates';
import { formatDate } from '@/features/house-scanner/utils/format';
import {
  applyListingFilters,
  listingHost,
} from '@/features/house-scanner/utils/listing-filters';
import { scopeListings } from '@/features/house-scanner/utils/listing-view';
import { viewingsWithin } from '@/features/house-scanner/utils/viewings';

// Any action may be missing, which turns its control off.
export interface HouseholdWorkspaceProps extends Partial<HouseholdActions> {
  snapshot: Snapshot;
  userId: string;
  mapStyleUrl?: string;
  onSignOut?: () => void;
  access?: HouseholdAccessActions;
}

export function HouseholdWorkspace({
  snapshot,
  userId,
  mapStyleUrl,
  onSignOut,
  onSaveFavorite,
  onSaveFavorites,
  onRemoveFavorite,
  onAddManual,
  onUpdateManual,
  onDeleteManual,
  onSaveProfile,
  onSetHidden,
  onLoadNotes,
  onSaveNote,
  access,
}: HouseholdWorkspaceProps) {
  const navigation = useBrowseNavigation();
  const { tab, search, listingId } = navigation;
  const { person, section, filters, view } = search;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailsOpen = listingId !== null;
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const duplicate = snapshot.listings.find(
    (listing) => listing.id === duplicateId,
  );
  const { pending, message, favorite, canSave, saveMany, batchBusy } =
    useFavoriteToggle({
      snapshot,
      userId,
      onSaveFavorite,
      onSaveFavorites,
      onRemoveFavorite,
    });
  const synthetic = snapshot.edition?.coverage === 'synthetic';
  const [satellite, setSatellite] = useState(false);
  const deferredSearch = useDeferredValue(filters);
  // Favorites keep hidden homes in view, marked on the card, so a member's save never disappears.
  const deferredFilters = useMemo(
    () =>
      tab === 'favorites'
        ? { ...deferredSearch, hidden: 'both' as const }
        : deferredSearch,
    [tab, deferredSearch],
  );
  const scoped = useMemo(
    () => scopeListings(snapshot, { tab, person, section, userId }),
    [snapshot, tab, person, userId, section],
  );
  // Shared by the household: the database keeps them, and the demo keeps them in memory.
  const hiddenActions = useHiddenListings({
    snapshot,
    userId,
    persist: !synthetic,
    onSetHidden,
  });
  const { hidden, hide, unhide } = hiddenActions;
  const { hidden: duplicateIds, alsoOn } = useMemo(
    () => findDuplicates(snapshot),
    [snapshot],
  );
  const visible = useMemo(
    () => applyListingFilters(scoped, deferredFilters, hidden, duplicateIds),
    [scoped, deferredFilters, hidden, duplicateIds],
  );
  // Cross-posted copies the filters leave out, so the count line can say they were folded.
  const duplicateCount = useMemo(
    () =>
      deferredFilters.showDuplicates
        ? 0
        : applyListingFilters(
            scoped,
            { ...deferredFilters, showDuplicates: true },
            hidden,
          ).length - visible.length,
    [scoped, deferredFilters, hidden, visible],
  );
  // Hidden homes the filters leave out, so the count line can say they exist.
  const hiddenCount = useMemo(
    () =>
      deferredFilters.hidden === 'not-hidden'
        ? applyListingFilters(
            scoped,
            { ...deferredFilters, hidden: 'hidden-only' },
            hidden,
            duplicateIds,
          ).length
        : 0,
    [scoped, deferredFilters, hidden, duplicateIds],
  );
  // Saved homes with a viewing in the next two days, for the badge on the tab.
  const viewingsSoon = useMemo(() => {
    const now = Date.now();
    return viewingsWithin(
      favoriteViewings(snapshot, 'everyone', userId, now),
      48,
      now,
    );
  }, [snapshot, userId]);
  const filterHosts = useMemo(
    () => [...new Set(snapshot.listings.map(listingHost))],
    [snapshot.listings],
  );
  const selected = listingId
    ? (snapshot.listings.find((listing) => listing.id === listingId) ?? null)
    : (visible.find((listing) => listing.id === selectedId) ?? null);
  // At most one card shows details at a time, so one controller serves them all.
  const notesListingId =
    tab === 'manual' ? (duplicate?.id ?? null) : (selected?.id ?? null);
  const notes = useListingNotes({
    listingId: tab === 'settings' || tab === 'viewings' ? null : notesListingId,
    userId,
    onLoad: onLoadNotes,
    onSave: onSaveNote,
  });
  const editionAge = snapshot.edition
    ? Date.now() - Date.parse(snapshot.edition.publishedAt)
    : null;
  const stale = editionAge !== null && editionAge > 36 * 60 * 60 * 1000;
  const manualActions =
    onUpdateManual && onDeleteManual
      ? {
          onUpdate: onUpdateManual,
          onDelete: async (id: string) => {
            await onDeleteManual(id);
            if (listingId === id) navigation.closeListing();
          },
        }
      : null;
  return (
    <ManualActionsProvider value={manualActions}>
      <section className={classes.workspace} aria-label="Household shortlist">
        {/* A new household starts with one profile at revision 1, set to the collector bounds. */}
        {!synthetic &&
          tab !== 'settings' &&
          snapshot.profiles.length === 1 &&
          snapshot.profiles[0].revision === 1 && (
            <Group gap={4} role="note">
              <Text size="sm">
                This household uses starter criteria: apartments in Göteborg
                from 60 m², up to 6M SEK.
              </Text>
              <Button
                size="compact-sm"
                variant="subtle"
                onClick={() => navigation.changeTab('settings')}
              >
                Adjust them in Settings
              </Button>
            </Group>
          )}
        <Group
          component="nav"
          aria-label="Shortlist sections"
          gap="xs"
          wrap="wrap"
          p={4}
          className={classes.tabBar}
        >
          {(['suggestions', 'favorites'] as const).map((value) => (
            <Button
              key={value}
              className={classes.navTab}
              variant={tab === value ? 'filled' : 'default'}
              aria-pressed={tab === value}
              leftSection={
                value === 'suggestions' ? (
                  <House size={20} aria-hidden />
                ) : (
                  <Star
                    size={20}
                    fill={tab === value ? 'currentColor' : 'none'}
                    aria-hidden
                  />
                )
              }
              onClick={() => navigation.changeTab(value)}
            >
              {value === 'suggestions' ? 'Listings' : 'Favorites'}
            </Button>
          ))}
          <Button
            className={classes.navTab}
            variant={tab === 'viewings' ? 'filled' : 'default'}
            aria-pressed={tab === 'viewings'}
            leftSection={<CalendarDays size={20} aria-hidden />}
            rightSection={
              viewingsSoon > 0 && (
                <Badge
                  size="sm"
                  variant="light"
                  aria-label={`${viewingsSoon} saved viewings in the next 48 hours`}
                >
                  {viewingsSoon}
                </Badge>
              )
            }
            onClick={() => navigation.changeTab('viewings')}
          >
            Viewings
          </Button>
          <Menu position="bottom-end">
            <Menu.Target>
              <Button
                className={classes.navTab}
                leftSection={<Ellipsis size={20} aria-hidden />}
                variant={
                  tab !== 'suggestions' &&
                  tab !== 'favorites' &&
                  tab !== 'viewings'
                    ? 'filled'
                    : 'default'
                }
              >
                More
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => navigation.changeTab('manual')}>
                Add link
              </Menu.Item>
              <Menu.Item onClick={() => navigation.changeTab('settings')}>
                Settings
              </Menu.Item>
              {onSignOut && <Menu.Item onClick={onSignOut}>Sign out</Menu.Item>}
            </Menu.Dropdown>
          </Menu>
        </Group>
        {listingId && !selected && (
          <Group role="status">
            <Text>This home is unavailable in this household.</Text>
            <Button variant="default" onClick={navigation.closeListing}>
              Back to {tab === 'favorites' ? 'Favorites' : 'Listings'}
            </Button>
          </Group>
        )}
        {message && (
          <Text role="status" aria-live="polite">
            {message}
          </Text>
        )}
        {tab === 'manual' ? (
          <AddLinkPanel
            snapshot={snapshot}
            userId={userId}
            duplicate={duplicate}
            pending={pending}
            canSave={canSave}
            notes={notes}
            onAddManual={onAddManual}
            onExisting={setDuplicateId}
            onCloseDuplicate={() => setDuplicateId(null)}
            onFavorite={favorite}
          />
        ) : tab === 'viewings' ? (
          <ViewingsPanel snapshot={snapshot} userId={userId} />
        ) : tab === 'settings' ? (
          <SettingsPanel
            snapshot={snapshot}
            userId={userId}
            synthetic={synthetic}
            onSaveProfile={onSaveProfile}
            access={access}
          />
        ) : (
          <PriceEstimateProvider listings={snapshot.listings}>
            <ListingsPanel
              tab={tab}
              snapshot={snapshot}
              userId={userId}
              mapStyleUrl={mapStyleUrl}
              person={person}
              onPersonChange={(value) =>
                navigation.updateSearch({ person: value })
              }
              section={section}
              onSectionChange={(value) =>
                navigation.updateSearch({
                  section: validateBrowseSearch({ section: value }).section,
                })
              }
              filters={filters}
              hiddenIds={hidden}
              hiddenCount={hiddenCount}
              duplicateCount={duplicateCount}
              alsoOn={alsoOn}
              onHide={hide}
              onHideMany={hiddenActions.hideMany}
              onUndoHide={hiddenActions.undo}
              hideBusy={hiddenActions.busy}
              hideError={hiddenActions.error}
              hideMessage={hiddenActions.message}
              undoHideCount={hiddenActions.undoCount}
              canHide={hiddenActions.canHide}
              selecting={search.select}
              onSelectingChange={(value) =>
                navigation.setLayer('select', value)
              }
              filtersOpen={search.filterOpen}
              onFiltersOpenChange={(value) =>
                navigation.setLayer('filterOpen', value)
              }
              onUnhide={unhide}
              onFiltersChange={(value) =>
                navigation.updateSearch({ filters: value })
              }
              filterHosts={filterHosts}
              total={scoped.length}
              scoped={scoped}
              duplicateIds={duplicateIds}
              visible={visible}
              selected={selected}
              selectedId={listingId ?? selectedId}
              onSelectedIdChange={setSelectedId}
              detailsOpen={detailsOpen}
              onOpenListing={(id) => {
                setSelectedId(id);
                navigation.openListing(id);
              }}
              onCloseListing={navigation.closeListing}
              onSeeSelectedOnMap={() => {
                setSelectedId(listingId);
                navigation.seeSelectedOnMap();
              }}
              sort={search.sort}
              onSortChange={(value) => navigation.updateSearch({ sort: value })}
              view={view}
              onViewChange={(value) => navigation.updateSearch({ view: value })}
              satellite={satellite}
              onSatelliteChange={setSatellite}
              pending={pending}
              favoriteMessage={message}
              mapWarning={
                stale && !synthetic
                  ? 'Over 36 hours old, so facts may be stale.'
                  : undefined
              }
              canSave={canSave}
              notes={notes}
              onFavorite={favorite}
              onSaveMany={onSaveFavorites ? saveMany : undefined}
              saveBusy={batchBusy}
            />
          </PriceEstimateProvider>
        )}
        {/* The demo's fixed edition date is always old, so only real editions warn. */}
        <Text
          size="sm"
          mt="md"
          c={stale && !synthetic ? 'red.8' : 'dimmed'}
          role="status"
        >
          {synthetic
            ? 'Fictional demo · Changes stay in memory.'
            : snapshot.edition
              ? `Updated ${formatDate(snapshot.edition.publishedAt)}${stale ? '. Over 36 hours old, so facts may be stale.' : ''}`
              : 'No data has been published yet.'}
        </Text>
      </section>
    </ManualActionsProvider>
  );
}
