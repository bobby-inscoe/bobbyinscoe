import {
  Box,
  Button,
  Checkbox,
  Drawer,
  Group,
  Stack,
  Text,
} from '@mantine/core';
import { ListingPhoto } from '@/features/house-scanner/components/listing-photo';
import {
  KeyFacts,
  PriceLine,
} from '@/features/house-scanner/components/listing-summary';
import type { Listing } from '@/features/house-scanner/types/contracts';

/** A shared pin never selects unseen homes; choose from photos and facts instead. */
export function MapStackSelection({
  listings,
  checkedIds,
  disabled,
  onToggle,
  onDetails,
  onClose,
}: {
  listings: Listing[];
  checkedIds: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (id: string) => void;
  onDetails: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Drawer
      opened
      onClose={onClose}
      title="Choose homes at this pin"
      size="md"
      position="right"
      closeButtonProps={{ 'aria-label': 'Close pin selection' }}
    >
      <Stack>
        <Text size="sm">
          These homes share a map point. Select them individually; your other
          selections stay checked.
        </Text>
        {listings.map((listing) => {
          const checked = checkedIds.has(listing.id);
          const unavailable = disabled || (checkedIds.size >= 500 && !checked);
          return (
            <Group key={listing.id} wrap="nowrap" align="flex-start">
              <Box w={88} flex="none">
                <ListingPhoto
                  listing={listing}
                  onOpen={() => onToggle(listing.id)}
                  actionLabel={`${checked ? 'Deselect' : 'Select'} ${listing.title}`}
                  pressed={checked}
                  disabled={unavailable}
                />
              </Box>
              <Stack gap={4} miw={0}>
                <Checkbox
                  checked={checked}
                  disabled={unavailable}
                  label={listing.title}
                  onChange={() => onToggle(listing.id)}
                />
                <PriceLine listing={listing} />
                <KeyFacts listing={listing} />
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => onDetails(listing.id)}
                >
                  Details
                </Button>
              </Stack>
            </Group>
          );
        })}
        <Button variant="default" onClick={onClose}>
          Back to map · {checkedIds.size} selected
        </Button>
      </Stack>
    </Drawer>
  );
}
