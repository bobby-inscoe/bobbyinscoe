import { Button, Menu } from '@mantine/core';
import { useState } from 'react';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type { Listing } from '@/features/house-scanner/types/contracts';
import { hasPin } from '@/features/house-scanner/utils/listing-position';

export function ListingCardMenu({
  listing,
  onSeeOnMap,
}: {
  listing: Listing;
  onSeeOnMap?: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const shareUrl = listing.sourceUrls[0];
  const located = onSeeOnMap && hasPin(listing.coordinates);
  const canShare = typeof navigator.share === 'function';
  const share = async () => {
    try {
      if (canShare) {
        await navigator.share({ title: listing.title, url: shareUrl });
        return;
      }
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A dismissed share sheet or blocked clipboard leaves the card unchanged.
    }
  };
  if (!shareUrl && !located) return null;
  return (
    <Menu position="bottom-end" classNames={{ item: classes.cardMenuItem }}>
      <Menu.Target>
        <Button
          size="xs"
          variant="subtle"
          aria-label={`More actions for ${listing.title}`}
        >
          More
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {shareUrl && (
          <Menu.Item onClick={share} closeMenuOnClick={canShare}>
            {copied ? 'Link copied' : 'Share this listing'}
          </Menu.Item>
        )}
        {located && (
          <Menu.Item onClick={() => onSeeOnMap(listing.id)}>
            See on map
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
