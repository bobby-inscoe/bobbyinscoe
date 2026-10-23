import { Button, Drawer, Group, Modal, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { LayoutTemplate } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { FavoriteStar } from '@/features/house-scanner/components/favorite-star';
import { HideButton } from '@/features/house-scanner/components/hide-button';
import { ListingDetails } from '@/features/house-scanner/components/listing-details';
import { ListingGallery } from '@/features/house-scanner/components/listing-gallery';
import {
  AlsoOn,
  OriginalListingButton,
  PriceLine,
  ReasonChips,
} from '@/features/house-scanner/components/listing-summary';
import { LocationPreview } from '@/features/house-scanner/components/location-preview';
import { MonthlyCost } from '@/features/house-scanner/components/monthly-cost';
import { EstimateLine } from '@/features/house-scanner/components/price-estimate';
import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
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
  mapStyleUrl?: string;
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
  mapStyleUrl,
  alsoOn,
  hideError,
}: ListingDrawerProps) {
  const intl = useIntl();
  const viewport = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  useEffect(() => {
    if (!opened) setEntered(false);
  }, [opened]);
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    if (!opened || !listing) setFullScreen(false);
  }, [opened, listing]);

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
    <>
      <Drawer.Root
        opened={opened}
        onEnterTransitionEnd={() => setEntered(true)}
        transitionProps={{ duration: reducedMotion ? 0 : 200 }}
        onClose={() => {
          setFullScreen(false);
          onClose();
        }}
        trapFocus={!fullScreen}
        closeOnEscape={!fullScreen}
        position={wide ? 'right' : 'bottom'}
        size={wide ? 'lg' : '100%'}
      >
        <Drawer.Overlay />
        <Drawer.Content p={0} ref={viewport}>
          <Drawer.Header className={classes.drawerHeader}>
            <Drawer.Title className={classes.drawerTitle}>
              {listing?.title}
            </Drawer.Title>
            <Drawer.CloseButton
              aria-label={intl.formatMessage({
                id: 'listings.details.closeListingDetails',
              })}
            />
          </Drawer.Header>
          <Drawer.Body className={classes.drawerSheetBody}>
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
                    onOpen={() => setFullScreen(true)}
                  >
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
                {photos[0] && (
                  <Text size="sm" c="dimmed">
                    {displayLabel(intl, photos[0].attribution)}
                  </Text>
                )}
                <PriceLine listing={listing} />
                <EstimateLine listing={listing} />
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
                  locationPreview={
                    <>
                      {opened && hasPin(listing.coordinates) && (
                        <LocationPreview
                          coordinates={listing.coordinates}
                          styleUrl={mapStyleUrl}
                          ready={entered || !!reducedMotion}
                          viewport={viewport}
                          onActivate={onSeeOnMap}
                        />
                      )}
                      {estimatedPositionLabel(listing.coordinates, intl) && (
                        <Text size="sm">
                          {estimatedPositionLabel(listing.coordinates, intl)}
                        </Text>
                      )}
                    </>
                  }
                  monthlyCost={
                    // Remount per home and opening to discard price and cash edits on close.
                    <MonthlyCost
                      key={`${listing.id}-${opened}`}
                      listing={listing}
                      snapshot={snapshot}
                    />
                  }
                  onSelectPhoto={showPhoto}
                />
              </Stack>
            )}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
      <Modal.Root
        opened={fullScreen && opened && !!listing}
        onClose={() => setFullScreen(false)}
        fullScreen
        returnFocus={false}
        onExitTransitionEnd={() =>
          photoRef.current
            ?.querySelector<HTMLButtonElement>('button:not([inert] button)')
            ?.focus()
        }
        zIndex={300}
      >
        <Modal.Overlay />
        <Modal.Content
          p={0}
          radius={0}
          aria-label={intl.formatMessage({
            id: 'listings.details.fullScreenPhotos',
          })}
        >
          <Modal.Body p={0} className={classes.fullScreenBody}>
            {listing && (
              <ListingGallery
                key={`${listing.id}-${showingFloorPlan}-full`}
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
                contain
                fullScreen
              >
                {null}
              </ListingGallery>
            )}
            <Group gap="xs" className={classes.fullScreenToolbar}>
              {listing && <OriginalListingButton listing={listing} />}
              <Modal.CloseButton
                className={classes.exitFullScreen}
                aria-label={intl.formatMessage({
                  id: 'listings.details.exitFullScreen',
                })}
              />
            </Group>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </>
  );
}
