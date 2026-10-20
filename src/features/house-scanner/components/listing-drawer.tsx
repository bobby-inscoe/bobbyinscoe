import { Button, Drawer, Group, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { FavoriteStar } from '@/features/house-scanner/components/favorite-star';
import { HideButton } from '@/features/house-scanner/components/hide-button';
import styles from '@/features/house-scanner/components/household-workspace.module.css';
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
  favorite: { mine: boolean; canSave: boolean; busy: boolean };
  notes: ListingNotesController;
  onToggleHidden: (listingId: string) => void;
  onFavorite: (listingId: string) => void;
  onClose: () => void;
  onSeeOnMap: () => void;
  alsoOn?: string[];
  backLabel?: 'Back to listings' | 'Back to favorites';
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
  backLabel = 'Back to listings',
}: ListingDrawerProps) {
  const wide = useMediaQuery('(min-width: 48em)');
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      title={listing?.title}
      closeButtonProps={{ 'aria-label': 'Close listing details' }}
      position={wide ? 'right' : 'bottom'}
      size={wide ? 'lg' : '85%'}
      // Rendered in place so the feature's scoped CSS variables still apply.
      withinPortal={false}
      classNames={{
        root: styles.drawerRoot,
        inner: styles.drawerInner,
        title: styles.drawerTitle,
      }}
    >
      {listing && (
        <Stack gap="sm" className={styles.drawerBody}>
          <Group>
            <Button variant="subtle" mih={44} onClick={onClose}>
              {backLabel}
            </Button>
          </Group>
          <div className={styles.photoWrap}>
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
              Saved by{' '}
              {snapshot.favorites
                .filter((favorite) => favorite.listingId === listing.id)
                .map(
                  (favorite) =>
                    snapshot.members.find(
                      (member) => member.userId === favorite.userId,
                    )?.displayName || 'Household member',
                )
                .join(', ')}
            </Text>
          )}
          <MatchLines listing={listing} snapshot={snapshot} details />
          <Group>
            <OriginalListingButton listing={listing} />
            {hasPin(listing.coordinates) && (
              <Button size="xs" variant="default" onClick={onSeeOnMap}>
                See on map
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
