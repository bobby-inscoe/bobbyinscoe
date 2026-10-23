import {
  Badge,
  Box,
  Button,
  Checkbox,
  Group,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { memo, useMemo } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { FavoriteStar } from '@/features/house-scanner/components/favorite-star';
import { HideButton } from '@/features/house-scanner/components/hide-button';
import { ListingCardMenu } from '@/features/house-scanner/components/listing-card-menu';
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
import {
  EstimateLine,
  useHasEstimate,
} from '@/features/house-scanner/components/price-estimate';
import { NextViewing } from '@/features/house-scanner/components/viewing-list';
import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
import { messageValue } from '@/features/house-scanner/i18n/catalogs';
import { displayLabel } from '@/features/house-scanner/i18n/display-labels';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
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

// Compact cards swap to the phone summary below xs; a card with details always shows the full one.
const desktopOnly = (details?: boolean) =>
  details ? {} : { visibleFrom: 'xs' as const };
const phoneOnly = (details?: boolean) =>
  details ? { display: 'none' } : { hiddenFrom: 'xs' as const };

export const ListingCard = memo(function ListingCard({
  listing,
  snapshot,
  userId,
  selected,
  details,
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
  const intl = useIntl();

  const { saved, mine, summary } = useMemo(() => {
    const saved = snapshot.favorites.filter(
      (favorite) => favorite.listingId === listing.id,
    );
    const mine = saved.some((favorite) => favorite.userId === userId);
    const statusDisputed = listing.conflicts.includes('status');
    const showStatus =
      statusDisputed ||
      (listing.facts.status !== 'available' &&
        listing.facts.status !== 'unknown');
    const memberName = (id: string | null) =>
      snapshot.members.find((member) => member.userId === id)?.displayName ||
      intl.formatMessage({ id: 'listings.details.householdMember' });
    // A sold or withdrawn status already says why it is gone.
    const delisted =
      listing.delistedAt !== undefined &&
      (statusDisputed ||
        (listing.facts.status !== 'sold' &&
          listing.facts.status !== 'withdrawn'));
    const hiddenBy = snapshot.hides?.find(
      (hide) => hide.listingId === listing.id,
    )?.userId;
    const chips = reasonChips(listing, intl);
    const position =
      estimatedPositionLabel(listing.coordinates, intl) ??
      (listing.coordinates?.precision === 'approximate_area'
        ? intl.formatMessage({ id: 'listings.details.approximateAreaOnly' })
        : !listing.coordinates
          ? intl.formatMessage({ id: 'listings.details.positionUnknown' })
          : null);
    return {
      saved,
      mine,
      summary: (
        <>
          <Box {...desktopOnly(details)}>
            <ReasonChips listing={listing} />
          </Box>
          <Box {...phoneOnly(details)} className={classes.cardAmenities}>
            {chips.length > 0 && <Text size="sm">{chips.join(' · ')}</Text>}
            {position && (
              <Text size="sm" c="dimmed">
                {position}
              </Text>
            )}
          </Box>
          {(showStatus ||
            listing.facts.bidding === true ||
            listing.origin === 'manual' ||
            delisted ||
            hidden) && (
            <Group gap="xs" className={classes.cardStatus}>
              {showStatus && (
                <Badge variant="light">
                  {statusDisputed
                    ? intl.formatMessage({
                        id: 'listings.details.statusDisputed',
                      })
                    : displayLabel(intl, listing.facts.status)}
                </Badge>
              )}
              {listing.facts.bidding === true && (
                <Badge variant="light">
                  <FormattedMessage id="listings.details.bidding" />
                </Badge>
              )}
              {listing.origin === 'manual' && (
                <Badge variant="outline">
                  <FormattedMessage
                    id="listings.details.addedBy"
                    values={{
                      value0: messageValue(memberName(listing.addedBy)),
                    }}
                  />
                </Badge>
              )}
              {delisted && (
                <Badge variant="outline">
                  <FormattedMessage id="listings.details.noLongerListed" />
                </Badge>
              )}
              {hidden && (
                <Badge variant="outline">
                  {hiddenBy
                    ? intl.formatMessage(
                        { id: 'listings.details.hiddenBy' },
                        { value0: messageValue(memberName(hiddenBy)) },
                      )
                    : intl.formatMessage({ id: 'listings.details.hidden' })}
                </Badge>
              )}
            </Group>
          )}
          <Box {...desktopOnly(details)}>
            <MatchLines
              listing={listing}
              snapshot={snapshot}
              details={details}
            />
          </Box>
          {saved.length > 0 && (
            <Text size="sm" {...desktopOnly(details)}>
              <FormattedMessage id="listings.details.savedBy" />{' '}
              {saved.map((favorite) => memberName(favorite.userId)).join(', ')}
            </Text>
          )}
        </>
      ),
    };
  }, [listing, snapshot, userId, details, hidden, intl]);
  // Keep checkbox widgets mounted and reusable; opening Select only reveals their lightweight wrappers.
  const selectionControl = useMemo(
    () => (
      <Checkbox
        label={intl.formatMessage(
          { id: 'listings.details.select' },
          { value0: messageValue(listing.title) },
        )}
        checked={checked === true}
        disabled={selectionDisabled}
        onChange={() => onToggleSelection?.(listing.id)}
      />
    ),
    [
      listing.id,
      listing.title,
      checked,
      selectionDisabled,
      onToggleSelection,
      intl,
    ],
  );
  const estimated = useHasEstimate(listing);
  const selectionLabel = `${checked ? intl.formatMessage({ id: 'common.deselect' }) : intl.formatMessage({ id: 'common.select' })} ${listing.title}`;
  const openPrimary = () => {
    if (selectionMode) {
      if (!selectionDisabled) onToggleSelection?.(listing.id);
    } else onSelect(listing.id);
  };
  return (
    <article
      className={`${classes.card} ${!details ? classes.compactCard : ''} ${selected || checked ? classes.selected : ''}`}
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
      <div className={classes.selectionRow} hidden={!selectionMode}>
        {selectionControl}
      </div>
      <div className={`${classes.photoWrap} ${classes.cardPhoto}`}>
        <ListingPhoto
          listing={listing}
          isNew={listing.isNew}
          onOpen={openPrimary}
          actionLabel={selectionMode ? selectionLabel : undefined}
          pressed={selectionMode ? checked === true : undefined}
          disabled={selectionMode && selectionDisabled}
        />
        {onToggleHidden && (
          <HideButton
            listingId={listing.id}
            hidden={hidden === true}
            onToggle={onToggleHidden}
          />
        )}
        <FavoriteStar
          mine={mine}
          others={saved.length > 0}
          canSave={canSave}
          busy={busy}
          onToggle={() => onFavorite(listing.id)}
        />
      </div>
      <div className={classes.cardPrice}>
        {estimated ? (
          <EstimateLine listing={listing} />
        ) : (
          <PriceLine listing={listing} />
        )}
      </div>
      <Title order={3} size="h5" className={classes.cardTitle}>
        <UnstyledButton
          type="button"
          className={classes.titleButton}
          onClick={openPrimary}
          aria-label={selectionMode ? selectionLabel : undefined}
          aria-pressed={selectionMode ? checked === true : undefined}
          disabled={selectionMode && selectionDisabled}
        >
          {listing.title}
        </UnstyledButton>
      </Title>
      <Box {...desktopOnly(details)}>
        <FactsLine listing={listing} />
      </Box>
      <Box {...phoneOnly(details)} className={classes.cardFacts}>
        <KeyFacts listing={listing} />
      </Box>
      <Box {...desktopOnly(details)}>
        <AlsoOn sites={alsoOn} />
      </Box>
      <div className={classes.cardViewing}>
        <NextViewing listing={listing} />
      </div>
      {summary}
      <div className={classes.grow} />
      <Group gap="xs" className={classes.cardActions}>
        <Box {...desktopOnly(details)}>
          <OriginalListingButton listing={listing} />
        </Box>
        <Button
          size="xs"
          variant="default"
          onClick={() => onSelect(listing.id)}
          aria-pressed={details ? selected : undefined}
          aria-haspopup={details ? undefined : 'dialog'}
        >
          <FormattedMessage id="listings.details.details" />
        </Button>
        {onSeeOnMap && hasPin(listing.coordinates) && (
          <Box {...desktopOnly(details)}>
            <Button
              size="xs"
              variant="default"
              onClick={() => onSeeOnMap(listing.id)}
            >
              <FormattedMessage id="listings.details.seeOnMap" />
            </Button>
          </Box>
        )}
        <Box {...phoneOnly(details)}>
          <ListingCardMenu listing={listing} onSeeOnMap={onSeeOnMap} />
        </Box>
        {saved.length > 0 && (
          <Text size="xs" {...phoneOnly(details)}>
            <FormattedMessage
              id="listings.details.savedByMembers"
              values={{ count: saved.length }}
            />
          </Text>
        )}
      </Group>
      {!canSave && (
        <Text size="xs" className={classes.cardNotice}>
          <FormattedMessage id="listings.details.favoriteChangesAreUnavailableInThisView" />
        </Text>
      )}
      {details && (
        <ListingDetails
          listing={listing}
          snapshot={snapshot}
          userId={userId}
          notes={notes}
        />
      )}
    </article>
  );
});
