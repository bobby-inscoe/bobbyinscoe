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
import { FormattedMessage, useIntl } from 'react-intl';
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
import { messageValue } from '@/features/house-scanner/i18n/catalogs';
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
  layout = 'classic',
}: {
  layout?: 'classic' | 'photo';
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
  const intl = useIntl();

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
  const selectionAction = selection && (
    <Button
      size="sm"
      variant={selection.checked ? 'filled' : 'default'}
      aria-pressed={selection.checked}
      disabled={selection.disabled}
      onClick={selection.onToggle}
    >
      <FormattedMessage
        id={
          selection.checked
            ? 'listings.map.selected2'
            : 'listings.map.selectHome'
        }
      />
    </Button>
  );
  const closeButton = (
    <CloseButton
      aria-label={intl.formatMessage({ id: 'listings.map.closeSelectedHome' })}
      onClick={onClose}
    />
  );
  if (layout === 'photo')
    return (
      <article
        className={`${classes.pinCard} ${classes.photoPinCard}`}
        aria-label={intl.formatMessage(
          { id: 'listings.map.selectedHome' },
          { value0: messageValue(listing.title) },
        )}
      >
        <div className={classes.photoPinImage}>
          <ListingPhoto
            listing={listing}
            onOpen={onDetails}
            isNew={listing.isNew}
          />
          <div className={classes.photoPinClose}>{closeButton}</div>
          <Group
            className={classes.photoPinActions}
            justify="space-between"
            gap="xs"
          >
            <Button size="sm" variant="default" onClick={onDetails}>
              <FormattedMessage id="listings.map.details" />
            </Button>
            <Group gap="xs">{selectionAction || personalActions}</Group>
          </Group>
        </div>
        <div className={classes.photoPinSummary}>
          <Title order={3} size="h5">
            <UnstyledButton className={classes.titleButton} onClick={onDetails}>
              {listing.title}
              <Text component="span" display="block" size="sm" fw={700}>
                {listing.conflicts.includes('askingPriceSek')
                  ? intl.formatMessage({ id: 'listings.map.priceDisputed' })
                  : listing.facts.askingPriceSek === null
                    ? intl.formatMessage({ id: 'listings.map.priceMissing' })
                    : formatPrice(listing.facts.askingPriceSek, intl)}
              </Text>
            </UnstyledButton>
          </Title>
          <KeyFacts listing={listing} />
        </div>
      </article>
    );
  return (
    <article
      className={classes.pinCard}
      aria-label={intl.formatMessage(
        { id: 'listings.map.selectedHome' },
        { value0: messageValue(listing.title) },
      )}
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
                <FormattedMessage id="listings.map.new" />
              </Badge>
            </>
          )}
        </Title>
        {closeButton}
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
          {listing.facts.askingPriceSek === null
            ? intl.formatMessage({ id: 'listings.map.priceMissing' })
            : formatPrice(listing.facts.askingPriceSek, intl)}
          {listing.conflicts.includes('askingPriceSek') &&
            intl.formatMessage({ id: 'listings.details.disputed' })}
        </Text>
      )}
      <div className={classes.pinFacts}>
        <KeyFacts listing={listing} />
      </div>
      {!mobile && <AlsoOn sites={alsoOn} />}
      {!mobile && <NextViewing listing={listing} />}
      <Group gap="xs" className={classes.pinActions}>
        {selection ? selectionAction : mobile && personalActions}
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
            <FormattedMessage id="listings.map.openOriginalListing" />
          </Button>
        )}
        <Button size="sm" variant="default" onClick={onDetails}>
          <FormattedMessage id="listings.map.details" />
        </Button>
      </Group>
    </article>
  );
}
