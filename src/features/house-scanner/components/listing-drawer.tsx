import { ActionIcon, Button, Drawer, Group, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { ChevronLeft, ChevronRight, LayoutTemplate } from 'lucide-react';
import { useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { FavoriteStar } from '@/features/house-scanner/components/favorite-star';
import { HideButton } from '@/features/house-scanner/components/hide-button';
import { ListingDetails } from '@/features/house-scanner/components/listing-details';
import { ListingGallery } from '@/features/house-scanner/components/listing-gallery';
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
  hideError?: string;
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
  hideError,
}: ListingDrawerProps) {
  const intl = useIntl();

  const [selection, setSelection] = useState({ listingId: '', index: 0 });
  const photoRef = useRef<HTMLDivElement>(null);
  const photos = listing?.photos?.length
    ? listing.photos
    : listing?.photo
      ? [listing.photo]
      : [];
  const index = selection.listingId === listing?.id ? selection.index : 0;
  const floorPlan =
    listing?.floorPlan && Date.parse(listing.floorPlan.expiresAt) > Date.now()
      ? listing.floorPlan
      : null;
  const showingFloorPlan = index === -1 && !!floorPlan;
  const selectPhoto = (next: number) => {
    if (listing) setSelection({ listingId: listing.id, index: next });
  };
  const showPhoto = (index: number) => {
    selectPhoto(index);
    photoRef.current?.scrollIntoView({ block: 'start' });
  };
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
      size={wide ? 'lg' : '100%'}
      classNames={{
        title: classes.drawerTitle,
        header: classes.drawerHeader,
        body: classes.drawerSheetBody,
      }}
    >
      {listing && (
        <Stack gap="sm" className={classes.drawerBody}>
          <div ref={photoRef} className={classes.photoWrap}>
            <ListingGallery
              key={`${listing.id}-${showingFloorPlan}`}
              listing={
                showingFloorPlan
                  ? {
                      ...listing,
                      title: intl.formatMessage({
                        id: 'listings.details.floorPlan',
                      }),
                    }
                  : listing
              }
              photos={showingFloorPlan ? [floorPlan] : photos}
              index={showingFloorPlan ? 0 : index}
              onSelect={showingFloorPlan ? () => {} : selectPhoto}
              contain={showingFloorPlan}
            >
              {photos.length > 1 && !showingFloorPlan && (
                <>
                  <ActionIcon
                    variant="default"
                    size="lg"
                    radius="xl"
                    className={classes.photoPrevious}
                    aria-label={intl.formatMessage({
                      id: 'listings.details.previousPhoto',
                    })}
                    onClick={() =>
                      selectPhoto((index - 1 + photos.length) % photos.length)
                    }
                  >
                    <ChevronLeft size={22} aria-hidden />
                  </ActionIcon>
                  <ActionIcon
                    variant="default"
                    size="lg"
                    radius="xl"
                    className={classes.photoNext}
                    aria-label={intl.formatMessage({
                      id: 'listings.details.nextPhoto',
                    })}
                    onClick={() => selectPhoto((index + 1) % photos.length)}
                  >
                    <ChevronRight size={22} aria-hidden />
                  </ActionIcon>
                </>
              )}
              {floorPlan && (
                <Button
                  size="xs"
                  variant="default"
                  className={classes.photoFloorPlan}
                  leftSection={<LayoutTemplate size={16} aria-hidden />}
                  onClick={() => selectPhoto(showingFloorPlan ? 0 : -1)}
                  aria-pressed={showingFloorPlan}
                >
                  <FormattedMessage
                    id={
                      showingFloorPlan
                        ? 'listings.details.photos'
                        : 'listings.details.floorPlan'
                    }
                  />
                </Button>
              )}
              <HideButton
                listingId={listing.id}
                hidden={hidden}
                onToggle={onToggleHidden}
              />
              <FavoriteStar
                {...favorite}
                onToggle={() => onFavorite(listing.id)}
              />
            </ListingGallery>
          </div>
          {hideError && (
            <Text role="alert" size="sm">
              {hideError}
            </Text>
          )}
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
            onSelectPhoto={showPhoto}
          />
        </Stack>
      )}
    </Drawer>
  );
}
