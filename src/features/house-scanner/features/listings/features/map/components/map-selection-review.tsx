import { Button, Checkbox, Drawer, Group, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  KeyFacts,
  PriceLine,
} from '@/features/house-scanner/components/listing-summary';
import {
  type Feedback,
  formatFeedback,
  messageValue,
} from '@/features/house-scanner/i18n/catalogs';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type { Listing } from '@/features/house-scanner/types/contracts';

interface MapSelectionReviewProps {
  listings: Listing[];
  savedIds: ReadonlySet<string>;
  busy: boolean;
  error: Feedback;
  onClose: () => void;
  onHide: (ids: string[]) => void;
}

export function MapSelectionReview({
  listings,
  savedIds,
  busy,
  error,
  onClose,
  onHide,
}: MapSelectionReviewProps) {
  const intl = useIntl();

  const [selection, setSelection] = useState(() =>
    listings
      .filter((listing) => !savedIds.has(listing.id))
      .slice(0, 500)
      .map((listing) => listing.id),
  );
  const available = new Set(listings.map((listing) => listing.id));
  const checked = selection.filter((id) => available.has(id));
  const savedCount = checked.filter((id) => savedIds.has(id)).length;
  return (
    <Drawer
      opened
      onClose={onClose}
      title={intl.formatMessage({ id: 'listings.map.reviewHomesInThisView' })}
      position="right"
      size="md"
      closeButtonProps={{
        'aria-label': intl.formatMessage({
          id: 'listings.map.closeMapSelectionReview',
        }),
      }}
    >
      <Stack>
        <Text size="sm">
          <FormattedMessage
            id="listings.map.homesCapturedSavedHomesStartUncheckedHomesWithEstimated"
            values={{ value0: messageValue(listings.length) }}
          />
        </Text>
        {!listings.length && (
          <Text>
            <FormattedMessage id="listings.map.noEligibleHomesInThisViewCloseThisSheet" />
          </Text>
        )}
        {listings.map((listing) => (
          <Checkbox
            key={listing.id}
            className={classes.selectionRow}
            checked={checked.includes(listing.id)}
            disabled={
              busy || (checked.length >= 500 && !checked.includes(listing.id))
            }
            onChange={() =>
              setSelection((ids) =>
                checked.includes(listing.id)
                  ? ids.filter((id) => id !== listing.id)
                  : [...checked, listing.id],
              )
            }
            aria-label={intl.formatMessage(
              { id: 'listings.map.select' },
              { value0: messageValue(listing.title) },
            )}
            label={
              <Stack gap={2} py="xs">
                <Text fw={600}>{listing.title}</Text>
                <PriceLine listing={listing} />
                <KeyFacts listing={listing} />
                {savedIds.has(listing.id) && (
                  <Text size="sm">
                    <FormattedMessage id="listings.map.savedByYourHousehold" />
                  </Text>
                )}
              </Stack>
            }
          />
        ))}
        <Stack gap="xs" className={classes.selectionBar}>
          <Text role="status" aria-live="polite">
            <FormattedMessage
              id="listings.map.selectedHiddenForTheHousehold"
              values={{
                value0: messageValue(checked.length),
                value1: messageValue(
                  savedCount > 0 &&
                    intl.formatMessage(
                      { id: 'listings.list.includesSavedCount' },
                      { count: savedCount },
                    ),
                ),
              }}
            />
          </Text>
          {checked.length === 500 && (
            <Text size="sm">
              <FormattedMessage id="listings.map.500HomeLimitReachedHideThisBatchBeforeSelecting" />
            </Text>
          )}
          {error && <Text role="alert">{formatFeedback(intl, error)}</Text>}
          <Group justify="space-between">
            <Button variant="default" onClick={onClose}>
              <FormattedMessage id="common.cancel" />
            </Button>
            <Button
              disabled={busy || checked.length === 0}
              loading={busy}
              onClick={() => onHide(checked)}
            >
              <FormattedMessage
                id="listings.map.hide"
                values={{ value0: messageValue(checked.length) }}
              />
            </Button>
          </Group>
        </Stack>
      </Stack>
    </Drawer>
  );
}
