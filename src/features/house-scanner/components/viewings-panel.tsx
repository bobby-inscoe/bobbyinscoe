import { Anchor, Box, Group, Select, Stack, Text, Title } from '@mantine/core';
import { useMemo, useState } from 'react';

import styles from '@/features/house-scanner/components/household-workspace.module.css';
import { ListingPhoto } from '@/features/house-scanner/components/listing-photo';
import { CalendarButton } from '@/features/house-scanner/components/viewing-list';
import type { Snapshot } from '@/features/house-scanner/types/contracts';
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
}: {
  snapshot: Snapshot;
  userId: string;
}) {
  const [person, setPerson] = useState('everyone');
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
      <Title order={2}>Viewings</Title>
      <Select
        label="Saved by"
        w={{ base: 140, sm: 200 }}
        value={person}
        onChange={(value) => setPerson(value ?? 'everyone')}
        data={[
          { value: 'everyone', label: 'Everyone' },
          { value: 'mine', label: 'Mine' },
          ...snapshot.members.map((member) => ({
            value: member.userId,
            label: member.displayName,
          })),
        ]}
        comboboxProps={{ withinPortal: false }}
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
            <Box className={styles.viewingList}>
              {day.entries.map(({ listing, viewing }) => (
                <Box
                  key={`${listing.id}-${viewing.startsAt}`}
                  className={styles.card}
                >
                  <Box>
                    <ListingPhoto listing={listing} />
                  </Box>
                  <Stack gap={4} className={styles.grow}>
                    <Text size="lg" fw={700}>
                      {formatViewing(viewing)}
                    </Text>
                    <Text fw={600}>{listing.title}</Text>
                    <Text size="sm" c="dimmed">
                      Saved by {names(listing.id)}
                    </Text>
                  </Stack>
                  <Group gap="md">
                    <CalendarButton listing={listing} viewing={viewing} />
                    <Anchor
                      size="sm"
                      href={listing.sourceUrls[0]}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      Original listing
                    </Anchor>
                  </Group>
                </Box>
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
