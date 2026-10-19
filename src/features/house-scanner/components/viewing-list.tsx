import { Button, Group, Stack, Text } from '@mantine/core';

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
export function downloadCalendar(listing: Listing, viewing: Viewing) {
  const url = URL.createObjectURL(
    new Blob([viewingCalendar(listing, viewing, Date.now())], {
      type: 'text/calendar;charset=utf-8',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = calendarFileName(listing, viewing);
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
  return (
    <Button
      size="xs"
      variant="default"
      aria-label={`Add to calendar: ${listing.title}, ${formatViewing(viewing)}`}
      onClick={() => downloadCalendar(listing, viewing)}
    >
      Add to calendar
    </Button>
  );
}

/** The next viewing on a card, with a count of the others. Nothing when the source lists none. */
export function NextViewing({ listing }: { listing: Listing }) {
  const [next, ...more] = upcomingViewings(listing, Date.now());
  if (!next) return null;
  return (
    <Text size="sm" fw={600}>
      Viewing {formatViewing(next)}
      {more.length > 0 && ` (+${more.length} more)`}
    </Text>
  );
}

/** Every upcoming viewing of a home, each with its calendar button. */
export function ViewingRows({ listing }: { listing: Listing }) {
  const viewings = upcomingViewings(listing, Date.now());
  if (viewings.length === 0) return null;
  return (
    <Stack gap="xs">
      {viewings.map((viewing) => (
        <Group key={viewing.startsAt} justify="space-between" wrap="wrap">
          <Text size="sm">{formatViewing(viewing)}</Text>
          <CalendarButton listing={listing} viewing={viewing} />
        </Group>
      ))}
      <Text size="sm" c="dimmed">
        Times come from the broker's listing and can change. Open the original
        listing to book or confirm.
      </Text>
    </Stack>
  );
}
