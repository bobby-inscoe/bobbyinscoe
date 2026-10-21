import { Button, Checkbox, Drawer, Group, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import {
  KeyFacts,
  PriceLine,
} from '@/features/house-scanner/components/listing-summary';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type { Listing } from '@/features/house-scanner/types/contracts';

interface MapSelectionReviewProps {
  listings: Listing[];
  savedIds: ReadonlySet<string>;
  busy: boolean;
  error: string;
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
      title="Review homes in this view"
      position="right"
      size="md"
      closeButtonProps={{ 'aria-label': 'Close map selection review' }}
    >
      <Stack>
        <Text size="sm">
          {listings.length} homes captured. Saved homes start unchecked. Homes
          with estimated or missing locations are excluded. Moving the map does
          not change this set.
        </Text>
        {!listings.length && (
          <Text>
            No eligible homes in this view. Close this sheet and move or zoom
            the map.
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
            aria-label={`Select ${listing.title}`}
            label={
              <Stack gap={2} py="xs">
                <Text fw={600}>{listing.title}</Text>
                <PriceLine listing={listing} />
                <KeyFacts listing={listing} />
                {savedIds.has(listing.id) && (
                  <Text size="sm">Saved by your household</Text>
                )}
              </Stack>
            }
          />
        ))}
        <Stack gap="xs" className={classes.selectionBar}>
          <Text role="status" aria-live="polite">
            {checked.length} selected · Hidden for the household
            {savedCount > 0 &&
              ` · Includes ${savedCount} saved ${savedCount === 1 ? 'home' : 'homes'}`}
          </Text>
          {checked.length === 500 && (
            <Text size="sm">
              500-home limit reached. Hide this batch before selecting more.
            </Text>
          )}
          {error && <Text role="alert">{error}</Text>}
          <Group justify="space-between">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy || checked.length === 0}
              loading={busy}
              onClick={() => onHide(checked)}
            >
              Hide {checked.length}
            </Button>
          </Group>
        </Stack>
      </Stack>
    </Drawer>
  );
}
