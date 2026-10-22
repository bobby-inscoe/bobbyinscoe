import {
  Box,
  Button,
  Checkbox,
  Drawer,
  Group,
  Stack,
  Text,
} from '@mantine/core';
import { FormattedMessage, useIntl } from 'react-intl';
import { ListingPhoto } from '@/features/house-scanner/components/listing-photo';
import {
  KeyFacts,
  PriceLine,
} from '@/features/house-scanner/components/listing-summary';
import { messageValue } from '@/features/house-scanner/i18n/catalogs';
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
  const intl = useIntl();

  return (
    <Drawer
      opened
      onClose={onClose}
      title={intl.formatMessage({ id: 'listings.map.chooseHomesAtThisPin' })}
      size="md"
      position="right"
      closeButtonProps={{
        'aria-label': intl.formatMessage({
          id: 'listings.map.closePinSelection',
        }),
      }}
    >
      <Stack>
        <Text size="sm">
          <FormattedMessage id="listings.map.theseHomesShareAMapPointSelectThemIndividually" />
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
                  actionLabel={`${checked ? intl.formatMessage({ id: 'common.deselect' }) : intl.formatMessage({ id: 'common.select' })} ${listing.title}`}
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
                  <FormattedMessage id="listings.map.details" />
                </Button>
              </Stack>
            </Group>
          );
        })}
        <Button variant="default" onClick={onClose}>
          <FormattedMessage
            id="listings.map.backToMapSelected"
            values={{ value0: messageValue(checkedIds.size) }}
          />
        </Button>
      </Stack>
    </Drawer>
  );
}
