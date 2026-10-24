import { Button, Menu } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
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
  const intl = useIntl();
  const [copied, setCopied] = useState(false);
  const [armed, setArmed] = useState(false);
  const [opened, setOpened] = useState(false);
  const target = useRef<HTMLButtonElement>(null);
  // The armed button replaces the first one, so focus it before opening for focus to return there.
  useEffect(() => {
    if (!armed) return;
    target.current?.focus();
    setOpened(true);
  }, [armed]);
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
  const trigger = (
    <Button
      ref={target}
      size="xs"
      variant="subtle"
      aria-label={intl.formatMessage(
        { id: 'listings.details.moreActionsFor' },
        { value0: listing.title },
      )}
      // Mantine sets both once the menu mounts; until then the plain button announces the same.
      aria-haspopup={armed ? undefined : 'menu'}
      aria-expanded={armed ? undefined : false}
      onClick={armed ? undefined : () => setArmed(true)}
    >
      <FormattedMessage id="listings.details.more" />
    </Button>
  );
  // Every card has this menu, so the Mantine menu mounts on first use and opens at once.
  if (!armed) return trigger;
  return (
    <Menu
      position="bottom-end"
      opened={opened}
      onChange={setOpened}
      classNames={{ item: classes.cardMenuItem }}
    >
      <Menu.Target>{trigger}</Menu.Target>
      <Menu.Dropdown>
        {shareUrl && (
          <Menu.Item onClick={share} closeMenuOnClick={canShare}>
            {copied ? (
              <FormattedMessage id="listings.details.linkCopied" />
            ) : (
              <FormattedMessage id="listings.details.shareThisListing" />
            )}
          </Menu.Item>
        )}
        {located && (
          <Menu.Item onClick={() => onSeeOnMap(listing.id)}>
            <FormattedMessage id="listings.details.seeOnMap" />
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
