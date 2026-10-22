import { Button, Group, Menu, Text } from '@mantine/core';
import { CalendarDays, Ellipsis, House, Star } from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { ListingDrawer } from '@/features/house-scanner/components/listing-drawer';
import { ManualActionsProvider } from '@/features/house-scanner/components/manual-listing-actions';
import { PriceEstimateProvider } from '@/features/house-scanner/components/price-estimate';
import { AddLinkPanel } from '@/features/house-scanner/features/add-link/components/add-link-panel';
import { useFavoriteToggle } from '@/features/house-scanner/features/favorites/hooks/use-favorite-toggle';
import { ListingsPanel } from '@/features/house-scanner/features/listings/components/listings-panel';
import { SettingsPanel } from '@/features/house-scanner/features/settings/components/settings-panel';
import { ViewingsPanel } from '@/features/house-scanner/features/viewings/components/viewings-panel';
import { useBrowseNavigation } from '@/features/house-scanner/hooks/use-browse-navigation';
import { useHiddenListings } from '@/features/house-scanner/hooks/use-hidden-listings';
import { useListingNotes } from '@/features/house-scanner/hooks/use-listing-notes';
import {
  formatFeedback,
  messageValue,
} from '@/features/house-scanner/i18n/catalogs';
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
  const intl = useIntl();

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
    listingId:
      tab === 'settings' || (tab === 'viewings' && !detailsOpen)
        ? null
        : notesListingId,
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
      <section
        className={classes.workspace}
        aria-label={intl.formatMessage({ id: 'navigation.householdShortlist' })}
      >
        {/* A new household starts with one profile at revision 1, set to the collector bounds. */}
        {!synthetic &&
          tab !== 'settings' &&
          snapshot.profiles.length === 1 &&
          snapshot.profiles[0].revision === 1 && (
            <Group gap={4} role="note">
              <Text size="sm">
                <FormattedMessage id="navigation.thisHouseholdUsesStarterCriteriaApartmentsInGoteborgFrom" />
              </Text>
              <Button
                size="compact-sm"
                variant="subtle"
                onClick={() => navigation.changeTab('settings')}
              >
                <FormattedMessage id="navigation.adjustThemInSettings" />
              </Button>
            </Group>
          )}
        <Group
          component="nav"
          aria-label={intl.formatMessage({
            id: 'navigation.shortlistSections',
          })}
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
              {value === 'suggestions'
                ? intl.formatMessage({ id: 'navigation.listings' })
                : intl.formatMessage({ id: 'navigation.favorites' })}
            </Button>
          ))}
          <Button
            className={classes.navTab}
            variant={tab === 'viewings' ? 'filled' : 'default'}
            aria-pressed={tab === 'viewings'}
            leftSection={
              <span className={classes.navIcon}>
                <CalendarDays size={20} aria-hidden />
              </span>
            }
            onClick={() => navigation.changeTab('viewings')}
          >
            <FormattedMessage id="navigation.viewings" />
          </Button>
          <Menu position="bottom-end">
            <Menu.Target>
              <Button
                className={classes.navTab}
                leftSection={
                  <Ellipsis
                    size={20}
                    fill={
                      tab !== 'suggestions' &&
                      tab !== 'favorites' &&
                      tab !== 'viewings'
                        ? 'currentColor'
                        : 'none'
                    }
                    aria-hidden
                  />
                }
                variant={
                  tab !== 'suggestions' &&
                  tab !== 'favorites' &&
                  tab !== 'viewings'
                    ? 'filled'
                    : 'default'
                }
              >
                <FormattedMessage id="navigation.more" />
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => navigation.changeTab('manual')}>
                <FormattedMessage id="navigation.addLink" />
              </Menu.Item>
              <Menu.Item onClick={() => navigation.changeTab('settings')}>
                <FormattedMessage id="navigation.settings" />
              </Menu.Item>
              {onSignOut && (
                <Menu.Item onClick={onSignOut}>
                  <FormattedMessage id="navigation.signOut" />
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
        {listingId && !selected && (
          <Group role="status">
            <Text>
              <FormattedMessage id="navigation.thisHomeIsUnavailableInThisHousehold" />
            </Text>
            <Button variant="default" onClick={navigation.closeListing}>
              <FormattedMessage
                id="navigation.backTo"
                values={{
                  value0: messageValue(
                    tab === 'favorites'
                      ? intl.formatMessage({ id: 'navigation.favorites' })
                      : intl.formatMessage({
                          id:
                            tab === 'viewings'
                              ? 'navigation.viewings'
                              : 'navigation.listings',
                        }),
                  ),
                }}
              />
            </Button>
          </Group>
        )}
        {message && (
          <Text role="status" aria-live="polite">
            {formatFeedback(intl, message)}
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
          <>
            {!detailsOpen && hiddenActions.error && (
              <Text role="alert">
                {formatFeedback(intl, hiddenActions.error)}
              </Text>
            )}
            <ViewingsPanel
              snapshot={snapshot}
              userId={userId}
              person={person}
              onPersonChange={(value) =>
                navigation.updateSearch({ person: value })
              }
              onOpenListing={navigation.openListing}
              onSeeOnMap={(id) => {
                setSelectedId(id);
                navigation.seeSelectedOnMap();
              }}
            />
            <PriceEstimateProvider listings={snapshot.listings}>
              <ListingDrawer
                listing={selected}
                snapshot={snapshot}
                userId={userId}
                alsoOn={selected ? alsoOn.get(selected.id) : undefined}
                opened={detailsOpen && selected !== null}
                hidden={selected ? hidden.has(selected.id) : false}
                favorite={{
                  mine: snapshot.favorites.some(
                    (entry) =>
                      entry.listingId === selected?.id &&
                      entry.userId === userId,
                  ),
                  others: snapshot.favorites.some(
                    (entry) =>
                      entry.listingId === selected?.id &&
                      entry.userId !== userId,
                  ),
                  canSave: selected ? canSave(selected.id) : false,
                  busy: selected ? pending.includes(selected.id) : false,
                }}
                notes={notes}
                hideError={formatFeedback(intl, hiddenActions.error)}
                onToggleHidden={(id) => {
                  if (hidden.has(id)) unhide(id);
                  else hide(id);
                }}
                onFavorite={favorite}
                onClose={navigation.closeListing}
                onSeeOnMap={() => {
                  setSelectedId(listingId);
                  navigation.seeSelectedOnMap();
                }}
              />
            </PriceEstimateProvider>
          </>
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
              hideError={formatFeedback(intl, hiddenActions.error)}
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
              mapWarning={
                stale && !synthetic
                  ? intl.formatMessage({
                      id: 'navigation.over36HoursOldSoFactsMayBeStale',
                    })
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
            ? intl.formatMessage({
                id: 'navigation.fictionalDemoChangesStayInMemory',
              })
            : snapshot.edition
              ? intl.formatMessage(
                  { id: 'navigation.updated' },
                  {
                    value0: messageValue(
                      formatDate(snapshot.edition.publishedAt, intl),
                    ),
                    value1: messageValue(
                      stale
                        ? intl.formatMessage({ id: 'navigation.staleSuffix' })
                        : '',
                    ),
                  },
                )
              : intl.formatMessage({
                  id: 'navigation.noDataHasBeenPublishedYet',
                })}
        </Text>
      </section>
    </ManualActionsProvider>
  );
}
