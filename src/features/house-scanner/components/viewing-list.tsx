import { Button, Group, Stack, Text } from '@mantine/core';
import { FormattedMessage, type IntlShape, useIntl } from 'react-intl';
import {
  englishIntl,
  messageValue,
} from '@/features/house-scanner/i18n/catalogs';

import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type {
  Listing,
  Viewing,
} from '@/features/house-scanner/types/contracts';
import {
  calendarFileName,
  formatViewing,
  upcomingViewings,
  viewingCalendar,
} from '@/features/house-scanner/utils/viewings';

/** Hands the browser a calendar file for one viewing; a phone offers to add it to its calendar. */
export function downloadCalendar(
  listing: Listing,
  viewing: Viewing,
  intl: IntlShape = englishIntl,
) {
  const url = URL.createObjectURL(
    new Blob([viewingCalendar(listing, viewing, Date.now(), intl)], {
      type: 'text/calendar;charset=utf-8',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = calendarFileName(listing, viewing, intl);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function CalendarButton({
  listing,
  viewing,
}: {
  listing: Listing;
  viewing: Viewing;
}) {
  const intl = useIntl();

  return (
    <Button
      size="xs"
      variant="default"
      aria-label={intl.formatMessage(
        { id: 'viewings.addToCalendar2' },
        {
          value0: messageValue(listing.title),
          value1: messageValue(formatViewing(viewing, intl)),
        },
      )}
      onClick={() => downloadCalendar(listing, viewing, intl)}
    >
      <FormattedMessage id="viewings.addToCalendar" />
    </Button>
  );
}

/** The next viewing on a card, with a count of the others. Nothing when the source lists none. */
export function NextViewing({ listing }: { listing: Listing }) {
  const intl = useIntl();

  const [next, ...more] = upcomingViewings(listing, Date.now());
  if (!next) return null;
  return (
    <Text size="sm" fw={700} className={classes.viewingTag}>
      <FormattedMessage
        id="viewings.viewing"
        values={{
          value0: messageValue(formatViewing(next, intl)),
          value1: messageValue(
            more.length > 0 &&
              intl.formatMessage(
                { id: 'viewings.more' },
                { value0: messageValue(more.length) },
              ),
          ),
        }}
      />
    </Text>
  );
}

/** Every upcoming viewing of a home, each with its calendar button. */
export function ViewingRows({ listing }: { listing: Listing }) {
  const intl = useIntl();

  const viewings = upcomingViewings(listing, Date.now());
  if (viewings.length === 0) return null;
  return (
    <Stack gap="xs">
      {viewings.map((viewing) => (
        <Group key={viewing.startsAt} justify="space-between" wrap="wrap">
          <Text size="sm">{formatViewing(viewing, intl)}</Text>
          <CalendarButton listing={listing} viewing={viewing} />
        </Group>
      ))}
      <Text size="sm" c="dimmed">
        <FormattedMessage id="viewings.timesComeFromTheBrokerSListingAndCan" />
      </Text>
    </Stack>
  );
}
