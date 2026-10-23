import { Badge, Stack, Text, UnstyledButton } from '@mantine/core';
import { House } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { messageValue } from '@/features/house-scanner/i18n/catalogs';
import { displayLabel } from '@/features/house-scanner/i18n/display-labels';

import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type { Listing } from '@/features/house-scanner/types/contracts';

export function ListingPhoto({
  listing,
  onOpen,
  actionLabel,
  disabled,
  pressed,
  isNew,
  contain,
  linkToListing = true,
}: {
  listing: Listing;
  onOpen?: () => void;
  actionLabel?: string;
  disabled?: boolean;
  pressed?: boolean;
  // Flags a fresh find in the photo's bottom-left corner, clear of the credit line below.
  isNew?: boolean;
  contain?: boolean;
  linkToListing?: boolean;
}) {
  const intl = useIntl();

  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const photo = listing.photo;
  const [expiryCheckAt, setExpiryCheckAt] = useState(Date.now);
  useEffect(() => {
    if (!photo) return;
    const remaining =
      Date.parse(photo.expiresAt) - Math.max(Date.now(), expiryCheckAt);
    if (remaining <= 0) return;
    const timeout = window.setTimeout(
      () => setExpiryCheckAt(Date.now()),
      Math.min(remaining, 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
  }, [photo, expiryCheckAt]);
  const permitted =
    photo &&
    failedUrl !== photo.url &&
    Date.parse(photo.expiresAt) > Date.now();
  const content = permitted ? (
    <img
      className={`${classes.photo} ${contain ? classes.containedPhoto : ''}`}
      src={photo.url}
      alt={listing.title}
      loading="lazy"
      referrerPolicy="no-referrer"
      width={550}
      height={366}
      onError={() => setFailedUrl(photo.url)}
    />
  ) : (
    <div className={classes.placeholder}>
      <House size={28} aria-hidden />
      <FormattedMessage id="listings.details.noPhoto" />
    </div>
  );
  return (
    <Stack gap="xs" className={classes.photoDisplay}>
      <div className={classes.photoFrame}>
        {onOpen ? (
          <UnstyledButton
            type="button"
            className={classes.photoButton}
            onClick={onOpen}
            aria-label={
              actionLabel ??
              intl.formatMessage(
                { id: 'listings.details.view' },
                { value0: messageValue(listing.title) },
              )
            }
            aria-pressed={pressed}
            disabled={disabled}
          >
            {content}
          </UnstyledButton>
        ) : permitted && linkToListing ? (
          <a
            className={classes.photoLink}
            href={listing.sourceUrls[0]}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            {content}
          </a>
        ) : (
          content
        )}
        {isNew && (
          <Badge variant="new" className={classes.newFlag}>
            <FormattedMessage id="listings.details.new" />
          </Badge>
        )}
      </div>
      {permitted && (
        <Text size="xs" c="dimmed" className={classes.photoAttribution}>
          {displayLabel(intl, photo.attribution)}
        </Text>
      )}
    </Stack>
  );
}
