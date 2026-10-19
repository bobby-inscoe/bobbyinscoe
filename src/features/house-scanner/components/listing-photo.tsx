import { Stack, Text } from '@mantine/core';
import { useEffect, useState } from 'react';

import styles from '@/features/house-scanner/components/household-workspace.module.css';
import type { Listing } from '@/features/house-scanner/types/contracts';

export function ListingPhoto({
  listing,
  onOpen,
  actionLabel,
  disabled,
  pressed,
}: {
  listing: Listing;
  onOpen?: () => void;
  actionLabel?: string;
  disabled?: boolean;
  pressed?: boolean;
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
      className={styles.photo}
      src={photo.url}
      alt={listing.title}
      loading="lazy"
      referrerPolicy="no-referrer"
      width={550}
      height={366}
      onError={() => setFailedUrl(photo.url)}
    />
  ) : (
    <div className={styles.placeholder}>No photo</div>
  );
  return (
    <Stack gap="xs">
      {onOpen ? (
        <button
          type="button"
          className={styles.photoButton}
          onClick={onOpen}
          aria-label={actionLabel ?? `View ${listing.title}`}
          aria-pressed={pressed}
          disabled={disabled}
        >
          {content}
        </button>
      ) : permitted ? (
        <a
          className={styles.photoLink}
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
      {permitted && (
        <Text size="xs" c="dimmed" className={styles.photoAttribution}>
          {photo.attribution}
        </Text>
      )}
    </Stack>
  );
}
