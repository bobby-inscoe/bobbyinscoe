import {
  Badge,
  Button,
  Checkbox,
  Group,
  Menu,
  Text,
  Title,
} from '@mantine/core';
import { memo, useMemo } from 'react';
import { FavoriteStar } from '@/features/house-scanner/components/favorite-star';
import { HideButton } from '@/features/house-scanner/components/hide-button';
import styles from '@/features/house-scanner/components/household-workspace.module.css';
import { ListingDetails } from '@/features/house-scanner/components/listing-details';
import { ListingPhoto } from '@/features/house-scanner/components/listing-photo';
import {
  AlsoOn,
  FactsLine,
  KeyFacts,
  MatchLines,
  OriginalListingButton,
  PriceLine,
  ReasonChips,
} from '@/features/house-scanner/components/listing-summary';
import { EstimateLine } from '@/features/house-scanner/components/price-estimate';
import { NextViewing } from '@/features/house-scanner/components/viewing-list';
import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
import type {
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import {
  estimatedPositionLabel,
  hasPin,
} from '@/features/house-scanner/utils/listing-position';
import { reasonChips } from '@/features/house-scanner/utils/match-listing';

interface ListingCardProps {
  listing: Listing;
  snapshot: Snapshot;
  userId: string;
  selected?: boolean;
  details?: boolean;
  stale?: boolean;
  busy: boolean;
  canSave: boolean;
  hidden?: boolean;
  notes?: ListingNotesController;
  alsoOn?: string[];
  selectionMode?: boolean;
  checked?: boolean;
  selectionDisabled?: boolean;
  onToggleSelection?: (listingId: string) => void;
  onSelect: (listingId: string) => void;
  onFavorite: (listingId: string) => void;
  onToggleHidden?: (listingId: string) => void;
  onSeeOnMap?: (listingId: string) => void;
}

export const ListingCard = memo(function ListingCard({
  listing,
  snapshot,
  userId,
  selected,
  details,
  stale,
  busy,
  canSave,
  hidden,
  notes,
  alsoOn,
  selectionMode,
  checked,
  selectionDisabled,
  onToggleSelection,
  onSelect,
  onFavorite,
  onToggleHidden,
  onSeeOnMap,
}: ListingCardProps) {
  const { saved, mine, summary } = useMemo(() => {
    const saved = snapshot.favorites.filter(
      (favorite) => favorite.listingId === listing.id,
    );
    const mine = saved.some((favorite) => favorite.userId === userId);
    const statusDisputed = listing.conflicts.includes('status');
    const showStatus = statusDisputed || listing.facts.status !== 'available';
    const memberName = (id: string | null) =>
      snapshot.members.find((member) => member.userId === id)?.displayName ||
      'Household member';
    const chips = reasonChips(listing, snapshot);
    const requiresLift = snapshot.profiles.some(
      (profile) => profile.enabled && profile.criteria.requireLift,
    );
    const caveat =
      requiresLift && listing.conflicts.includes('lift')
        ? 'Lift disputed'
        : requiresLift && listing.facts.lift === null
          ? 'Lift unknown'
          : chips.caveat;
    const position =
      estimatedPositionLabel(listing.coordinates) ??
      (listing.coordinates?.precision === 'approximate_area'
        ? 'Approximate area only'
        : !listing.coordinates
          ? 'Position unknown'
          : null);
    return {
      saved,
      mine,
      summary: (
        <>
          <div className={styles.desktopSummary}>
            <ReasonChips listing={listing} snapshot={snapshot} />
          </div>
          <div className={`${styles.mobileSummary} ${styles.cardAmenities}`}>
            {chips.facts.length > 0 && (
              <Text size="sm">{chips.facts.join(' · ')}</Text>
            )}
            {(caveat || position) && (
              <Text size="sm" c="dimmed">
                {[caveat, position].filter(Boolean).join(' · ')}
              </Text>
            )}
          </div>
          {(listing.isNew ||
            showStatus ||
            listing.origin === 'manual' ||
            stale ||
            hidden) && (
            <Group gap="xs" className={styles.cardStatus}>
              {listing.isNew && <Badge variant="light">New</Badge>}
              {showStatus && (
                <Badge variant="light">
                  {statusDisputed ? 'Status disputed' : listing.facts.status}
                </Badge>
              )}
              {listing.origin === 'manual' && (
                <Badge variant="outline">
                  Added by {memberName(listing.addedBy)}
                </Badge>
              )}
              {stale && <Badge variant="outline">Not in latest scan</Badge>}
              {hidden && <Badge variant="outline">Hidden</Badge>}
            </Group>
          )}
          <div className={styles.desktopSummary}>
            <MatchLines
              listing={listing}
              snapshot={snapshot}
              details={details}
            />
          </div>
          {saved.length > 0 && (
            <Text size="sm" className={styles.desktopSummary}>
              Saved by{' '}
              {saved.map((favorite) => memberName(favorite.userId)).join(', ')}
            </Text>
          )}
        </>
      ),
    };
  }, [listing, snapshot, userId, details, stale, hidden]);
  // Keep checkbox widgets mounted and reusable; opening Select only reveals their lightweight wrappers.
  const selectionControl = useMemo(
    () => (
      <Checkbox
        label={`Select ${listing.title}`}
        checked={checked === true}
        disabled={selectionDisabled}
        onChange={() => onToggleSelection?.(listing.id)}
      />
    ),
    [listing.id, listing.title, checked, selectionDisabled, onToggleSelection],
  );
  const selectionLabel = `${checked ? 'Deselect' : 'Select'} ${listing.title}`;
  const openPrimary = () => {
    if (selectionMode) {
      if (!selectionDisabled) onToggleSelection?.(listing.id);
    } else onSelect(listing.id);
  };
  return (
    <article
      className={`${styles.card} ${!details ? styles.compactCard : ''} ${selected || checked ? styles.selected : ''}`}
      aria-label={listing.title}
      tabIndex={selectionMode ? 0 : undefined}
      onKeyDown={
        selectionMode
          ? (event) => {
              if (
                event.target === event.currentTarget &&
                (event.key === ' ' || event.key === 'Enter')
              ) {
                event.preventDefault();
                if (!selectionDisabled) onToggleSelection?.(listing.id);
              }
            }
          : undefined
      }
      onClick={
        selectionMode
          ? (event) => {
              if (
                !selectionDisabled &&
                event.target instanceof HTMLElement &&
                !event.target.closest(
                  'button, a, input, label, [role="menuitem"]',
                )
              )
                onToggleSelection?.(listing.id);
            }
          : undefined
      }
    >
      <div className={styles.selectionRow} hidden={!selectionMode}>
        {selectionControl}
      </div>
      <div className={`${styles.photoWrap} ${styles.cardPhoto}`}>
        <ListingPhoto
          listing={listing}
          onOpen={openPrimary}
          actionLabel={selectionMode ? selectionLabel : undefined}
          pressed={selectionMode ? checked === true : undefined}
          disabled={selectionMode && selectionDisabled}
        />
        <div className={styles.desktopSummary}>
          {onToggleHidden && (
            <HideButton
              listingId={listing.id}
              hidden={hidden === true}
              onToggle={onToggleHidden}
            />
          )}
        </div>
        <FavoriteStar
          mine={mine}
          canSave={canSave}
          busy={busy}
          onToggle={() => onFavorite(listing.id)}
        />
      </div>
      <div className={styles.cardPrice}>
        <PriceLine listing={listing} />
      </div>
      <div className={styles.cardEstimate}>
        <EstimateLine listing={listing} />
      </div>
      <Title order={3} size="h5" className={styles.cardTitle}>
        <button
          type="button"
          className={styles.titleButton}
          onClick={openPrimary}
          aria-label={selectionMode ? selectionLabel : undefined}
          aria-pressed={selectionMode ? checked === true : undefined}
          disabled={selectionMode && selectionDisabled}
        >
          {listing.title}
        </button>
      </Title>
      <div className={styles.desktopSummary}>
        <FactsLine listing={listing} />
      </div>
      <div className={`${styles.mobileSummary} ${styles.cardFacts}`}>
        <KeyFacts listing={listing} />
      </div>
      <div className={styles.desktopSummary}>
        <AlsoOn sites={alsoOn} />
      </div>
      <div className={styles.cardViewing}>
        <NextViewing listing={listing} />
      </div>
      {summary}
      <div className={styles.grow} />
      <Group gap="xs" className={styles.cardActions}>
        <div className={styles.desktopSummary}>
          <OriginalListingButton listing={listing} />
        </div>
        <Button
          size="xs"
          variant="default"
          onClick={() => onSelect(listing.id)}
          aria-pressed={details ? selected : undefined}
          aria-haspopup={details ? undefined : 'dialog'}
        >
          Details
        </Button>
        {onSeeOnMap && hasPin(listing.coordinates) && (
          <div className={styles.desktopSummary}>
            <Button
              size="xs"
              variant="default"
              onClick={() => onSeeOnMap(listing.id)}
            >
              See on map
            </Button>
          </div>
        )}
        {(onToggleHidden || (onSeeOnMap && hasPin(listing.coordinates))) && (
          <div className={styles.mobileSummary}>
            <Menu withinPortal={false} position="bottom-end">
              <Menu.Target>
                <Button
                  size="xs"
                  variant="subtle"
                  aria-label={`More actions for ${listing.title}`}
                >
                  More
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                {onToggleHidden && (
                  <Menu.Item onClick={() => onToggleHidden(listing.id)}>
                    {hidden ? 'Unhide this home' : 'Hide this home'}
                  </Menu.Item>
                )}
                {onSeeOnMap && hasPin(listing.coordinates) && (
                  <Menu.Item onClick={() => onSeeOnMap(listing.id)}>
                    See on map
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          </div>
        )}
        {saved.length > 0 && (
          <Text size="xs" className={styles.mobileSummary}>
            Saved by {saved.length} {saved.length === 1 ? 'member' : 'members'}
          </Text>
        )}
      </Group>
      {!canSave && (
        <Text size="xs" className={styles.cardNotice}>
          Favorite changes are unavailable in this view.
        </Text>
      )}
      {details && (
        <ListingDetails
          listing={listing}
          snapshot={snapshot}
          userId={userId}
          stale={stale}
          notes={notes}
        />
      )}
    </article>
  );
});
