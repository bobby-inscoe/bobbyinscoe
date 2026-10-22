import {
  Box,
  Button,
  Group,
  Select,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useMemo } from 'react';
import { ListingCardMenu } from '@/features/house-scanner/components/listing-card-menu';
import { ListingPhoto } from '@/features/house-scanner/components/listing-photo';
import { KeyFacts } from '@/features/house-scanner/components/listing-summary';
import { CalendarButton } from '@/features/house-scanner/components/viewing-list';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type {
  Listing,
  Snapshot,
  Viewing,
} from '@/features/house-scanner/types/contracts';
import { formatDate } from '@/features/house-scanner/utils/format';
import {
  formatViewing,
  groupByDay,
  type UpcomingViewing,
  upcomingViewings,
} from '@/features/house-scanner/utils/viewings';

/** Every upcoming viewing of a home someone saved, as the panel and the tab badge both count them. */
export function favoriteViewings(
  snapshot: Snapshot,
  person: string,
  userId: string,
  now: number,
): UpcomingViewing[] {
  const wanted = person === 'mine' ? userId : person;
  const saved = new Set(
    snapshot.favorites
      .filter((entry) => person === 'everyone' || entry.userId === wanted)
      .map((entry) => entry.listingId),
  );
  return snapshot.listings
    .filter((listing) => saved.has(listing.id))
    .flatMap((listing) =>
      upcomingViewings(listing, now).map((viewing) => ({ listing, viewing })),
    );
}

export function ViewingsPanel({
  snapshot,
  userId,
  person,
  onPersonChange,
  onOpenListing,
  onSeeOnMap,
}: {
  snapshot: Snapshot;
  userId: string;
  person: string;
  onPersonChange: (person: string) => void;
  onOpenListing: (id: string) => void;
  onSeeOnMap: (id: string) => void;
}) {
  const days = useMemo(() => {
    const now = Date.now();
    return groupByDay(favoriteViewings(snapshot, person, userId, now), now);
  }, [snapshot, person, userId]);
  const names = (listingId: string) =>
    snapshot.favorites
      .filter((entry) => entry.listingId === listingId)
      .map(
        (entry) =>
          snapshot.members.find((member) => member.userId === entry.userId)
            ?.displayName || 'Household member',
      )
      .join(', ');
  return (
    <Stack>
      <Select
        label="Saved by"
        w={{ base: 140, sm: 200 }}
        value={person}
        onChange={(value) => onPersonChange(value ?? 'everyone')}
        data={[
          { value: 'everyone', label: 'Everyone' },
          { value: 'mine', label: 'Mine' },
          ...snapshot.members.map((member) => ({
            value: member.userId,
            label: member.displayName,
          })),
        ]}
      />
      {days.length === 0 ? (
        <Text>
          No saved home has an upcoming viewing. Save homes with the star; times
          appear here when the broker publishes them. Not every broker does.
        </Text>
      ) : (
        days.map((day) => (
          <Stack key={day.day} gap="xs" component="section">
            <Title order={3} size="h4">
              {day.label}
            </Title>
            <Box className={classes.viewingList}>
              {day.entries.map(({ listing, viewing }) => (
                <ViewingCard
                  key={`${listing.id}-${viewing.startsAt}`}
                  listing={listing}
                  viewing={viewing}
                  savedBy={names(listing.id)}
                  onOpen={() => onOpenListing(listing.id)}
                  onSeeOnMap={() => onSeeOnMap(listing.id)}
                />
              ))}
            </Box>
          </Stack>
        ))
      )}
      <Text size="sm" c="dimmed">
        {snapshot.edition
          ? `Updated ${formatDate(snapshot.edition.publishedAt)}. `
          : ''}
        A viewing can be cancelled or moved between scans, so confirm it on the
        broker's page.
      </Text>
    </Stack>
  );
}

function ViewingCard({
  listing,
  viewing,
  savedBy,
  onOpen,
  onSeeOnMap,
}: {
  listing: Listing;
  viewing: Viewing;
  savedBy: string;
  onOpen: () => void;
  onSeeOnMap: () => void;
}) {
  return (
    <Box
      component="article"
      aria-label={`${listing.title}, ${formatViewing(viewing)}`}
      className={`${classes.card} ${classes.viewingCard}`}
    >
      <Box className={classes.viewingThumb}>
        <ListingPhoto listing={listing} onOpen={onOpen} />
      </Box>
      <Stack gap={4} className={classes.grow}>
        <Text size="md" fw={800} className={classes.viewingTag}>
          {formatViewing(viewing)}
        </Text>
        <Title order={4} size="h4">
          <UnstyledButton
            type="button"
            className={classes.titleButton}
            onClick={onOpen}
            aria-haspopup="dialog"
          >
            {listing.title}
          </UnstyledButton>
        </Title>
        <KeyFacts listing={listing} />
        <Text size="sm" c="dimmed">
          Saved by {savedBy}
        </Text>
      </Stack>
      <Group gap="xs">
        <CalendarButton listing={listing} viewing={viewing} />
        <Button
          size="xs"
          variant="default"
          onClick={onOpen}
          aria-haspopup="dialog"
        >
          Details
        </Button>
        <ListingCardMenu listing={listing} onSeeOnMap={onSeeOnMap} />
      </Group>
    </Box>
  );
}
