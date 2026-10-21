import { Badge, Stack, Text, UnstyledButton } from '@mantine/core';
import { House } from 'lucide-react';
import { useEffect, useState } from 'react';

import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type { Listing } from '@/features/house-scanner/types/contracts';

export function ListingPhoto({
  listing,
  onOpen,
  actionLabel,
  disabled,
  pressed,
  isNew,
}: {
  listing: Listing;
  onOpen?: () => void;
  actionLabel?: string;
  disabled?: boolean;
  pressed?: boolean;
  // Flags a fresh find in the photo's bottom-left corner, clear of the credit line below.
  isNew?: boolean;
}) {
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
      className={classes.photo}
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
      No photo
    </div>
  );
  return (
    <Stack gap="xs">
      <div className={classes.photoFrame}>
        {onOpen ? (
          <UnstyledButton
            type="button"
            className={classes.photoButton}
            onClick={onOpen}
            aria-label={actionLabel ?? `View ${listing.title}`}
            aria-pressed={pressed}
            disabled={disabled}
          >
            {content}
          </UnstyledButton>
        ) : permitted ? (
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
            New
          </Badge>
        )}
      </div>
      {permitted && (
        <Text size="xs" c="dimmed" className={classes.photoAttribution}>
          {photo.attribution}
        </Text>
      )}
    </Stack>
  );
}
