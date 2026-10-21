import {
  Badge,
  Button,
  CloseButton,
  Group,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

import { FavoriteStar } from '@/features/house-scanner/components/favorite-star';
import { HideButton } from '@/features/house-scanner/components/hide-button';
import { ListingPhoto } from '@/features/house-scanner/components/listing-photo';
import {
  AlsoOn,
  KeyFacts,
} from '@/features/house-scanner/components/listing-summary';
import {
  EstimateLine,
  useHasEstimate,
} from '@/features/house-scanner/components/price-estimate';
import { NextViewing } from '@/features/house-scanner/components/viewing-list';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type { Listing } from '@/features/house-scanner/types/contracts';
import { formatPrice } from '@/features/house-scanner/utils/format';

// A compact card for the home chosen on the map: photo, headline facts and the way to the listing.
export function PinCard({
  listing,
  favorite,
  hidden,
  alsoOn,
  onFavorite,
  onToggleHidden,
  onClose,
  onDetails,
  selection,
}: {
  listing: Listing;
  // The member's own favorite of this home.
  favorite: {
    mine: boolean;
    others?: boolean;
    canSave: boolean;
    busy: boolean;
  };
  hidden: boolean;
  alsoOn?: string[];
  onFavorite: (listingId: string) => void;
  onToggleHidden: (listingId: string) => void;
  onClose: () => void;
  onDetails: () => void;
  selection?: { checked: boolean; disabled: boolean; onToggle: () => void };
}) {
  const mobile = useMediaQuery('(max-width: 36em)');
  const estimated = useHasEstimate(listing);
  const personalActions = (
    <>
      <HideButton
        listingId={listing.id}
        hidden={hidden}
        onToggle={onToggleHidden}
      />
      <FavoriteStar {...favorite} onToggle={() => onFavorite(listing.id)} />
    </>
  );
  return (
    <article
      className={classes.pinCard}
      aria-label={`Selected home: ${listing.title}`}
    >
      <Group
        className={classes.pinHeader}
        justify="space-between"
        wrap="nowrap"
        align="flex-start"
      >
        <Title order={3} size="h5">
          <UnstyledButton
            type="button"
            className={classes.titleButton}
            onClick={onDetails}
          >
            {listing.title}
          </UnstyledButton>
          {listing.isNew && (
            <>
              {' '}
              <Badge component="span" variant="new">
                New
              </Badge>
            </>
          )}
        </Title>
        <CloseButton aria-label="Close selected home" onClick={onClose} />
      </Group>
      <div className={`${classes.photoWrap} ${classes.pinPhoto}`}>
        <ListingPhoto listing={listing} onOpen={onDetails} />
        {!mobile && !selection && personalActions}
      </div>
      {estimated ? (
        <div className={classes.pinPrice}>
          <EstimateLine listing={listing} />
        </div>
      ) : (
        <Text fz="lg" className={`${classes.pinPrice} ${classes.priceText}`}>
          {formatPrice(listing.facts.askingPriceSek)}
          {listing.conflicts.includes('askingPriceSek') && ' (disputed)'}
        </Text>
      )}
      <div className={classes.pinFacts}>
        <KeyFacts listing={listing} />
      </div>
      {!mobile && <AlsoOn sites={alsoOn} />}
      {!mobile && <NextViewing listing={listing} />}
      <Group gap="xs" className={classes.pinActions}>
        {selection ? (
          <Button
            size="sm"
            variant={selection.checked ? 'filled' : 'default'}
            aria-pressed={selection.checked}
            disabled={selection.disabled}
            onClick={selection.onToggle}
          >
            {selection.checked ? 'Selected' : 'Select home'}
          </Button>
        ) : (
          mobile && personalActions
        )}
        {!mobile && !selection && (
          <Button
            component="a"
            size="sm"
            href={listing.sourceUrls[0]}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            // The global `a { color: inherit }` rule would otherwise hide the label on the filled button.
            c="var(--button-color)"
            td="none"
          >
            Open original listing
          </Button>
        )}
        <Button size="sm" variant="default" onClick={onDetails}>
          Details
        </Button>
      </Group>
    </article>
  );
}
