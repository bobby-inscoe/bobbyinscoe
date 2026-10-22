import { Button, Drawer, Group, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { FormattedMessage, useIntl } from 'react-intl';
import { FavoriteStar } from '@/features/house-scanner/components/favorite-star';
import { HideButton } from '@/features/house-scanner/components/hide-button';
import { ListingDetails } from '@/features/house-scanner/components/listing-details';
import { ListingPhoto } from '@/features/house-scanner/components/listing-photo';
import {
  AlsoOn,
  FactsLine,
  MatchLines,
  OriginalListingButton,
  PriceLine,
  ReasonChips,
} from '@/features/house-scanner/components/listing-summary';
import { EstimateLine } from '@/features/house-scanner/components/price-estimate';
import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type {
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import { hasPin } from '@/features/house-scanner/utils/listing-position';

interface ListingDrawerProps {
  // Null while no home is selected; the drawer stays mounted so Mantine can return focus on close.
  listing: Listing | null;
  snapshot: Snapshot;
  userId: string;
  opened: boolean;
  hidden: boolean;
  // The member's own favorite of this home.
  favorite: {
    mine: boolean;
    others?: boolean;
    canSave: boolean;
    busy: boolean;
  };
  notes: ListingNotesController;
  onToggleHidden: (listingId: string) => void;
  onFavorite: (listingId: string) => void;
  onClose: () => void;
  // Absent when the map is already showing.
  onSeeOnMap?: () => void;
  alsoOn?: string[];
}

// A side sheet on wide screens and a bottom sheet on narrow ones.
export function ListingDrawer({
  listing,
  snapshot,
  userId,
  opened,
  hidden,
  favorite,
  notes,
  onToggleHidden,
  onFavorite,
  onClose,
  onSeeOnMap,
  alsoOn,
}: ListingDrawerProps) {
  const intl = useIntl();

  const wide = useMediaQuery('(min-width: 48em)');
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={listing?.title}
      closeButtonProps={{
        'aria-label': intl.formatMessage({
          id: 'listings.details.closeListingDetails',
        }),
      }}
      position={wide ? 'right' : 'bottom'}
      size={wide ? 'lg' : '85%'}
      classNames={{
        title: classes.drawerTitle,
        header: classes.drawerHeader,
        body: classes.drawerSheetBody,
      }}
    >
      {listing && (
        <Stack gap="sm" className={classes.drawerBody}>
          <div className={classes.photoWrap}>
            <ListingPhoto listing={listing} />
            <HideButton
              listingId={listing.id}
              hidden={hidden}
              onToggle={onToggleHidden}
            />
            <FavoriteStar
              {...favorite}
              onToggle={() => onFavorite(listing.id)}
            />
          </div>
          <PriceLine listing={listing} />
          <EstimateLine listing={listing} />
          <FactsLine listing={listing} />
          <ReasonChips listing={listing} />
          <AlsoOn sites={alsoOn} />
          {snapshot.favorites.some(
            (favorite) => favorite.listingId === listing.id,
          ) && (
            <Text size="sm">
              <FormattedMessage id="listings.details.savedBy" />{' '}
              {snapshot.favorites
                .filter((favorite) => favorite.listingId === listing.id)
                .map(
                  (favorite) =>
                    snapshot.members.find(
                      (member) => member.userId === favorite.userId,
                    )?.displayName ||
                    intl.formatMessage({
                      id: 'listings.details.householdMember',
                    }),
                )
                .join(', ')}
            </Text>
          )}
          <MatchLines listing={listing} snapshot={snapshot} details />
          <Group>
            <OriginalListingButton listing={listing} />
            {onSeeOnMap && hasPin(listing.coordinates) && (
              <Button size="xs" variant="default" onClick={onSeeOnMap}>
                <FormattedMessage id="listings.details.seeOnMap" />
              </Button>
            )}
          </Group>
          <ListingDetails
            listing={listing}
            snapshot={snapshot}
            userId={userId}
            notes={notes}
            headingOrder={3}
          />
        </Stack>
      )}
    </Drawer>
  );
}
