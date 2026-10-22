import { Anchor, Box, Group, Select, Stack, Text, Title } from '@mantine/core';
import { useMemo, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { ListingPhoto } from '@/features/house-scanner/components/listing-photo';
import { CalendarButton } from '@/features/house-scanner/components/viewing-list';
import { messageValue } from '@/features/house-scanner/i18n/catalogs';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
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
  const intl = useIntl();

  const [person, setPerson] = useState('everyone');
  const days = useMemo(() => {
    const now = Date.now();
    return groupByDay(
      favoriteViewings(snapshot, person, userId, now),
      now,
      intl,
    );
  }, [snapshot, person, userId, intl]);
  const names = (listingId: string) =>
    snapshot.favorites
      .filter((entry) => entry.listingId === listingId)
      .map(
        (entry) =>
          snapshot.members.find((member) => member.userId === entry.userId)
            ?.displayName ||
          intl.formatMessage({ id: 'viewings.householdMember' }),
      )
      .join(', ');
  return (
    <Stack>
      <Title order={2}>
        <FormattedMessage id="viewings.viewings" />
      </Title>
      <Select
        label={intl.formatMessage({ id: 'viewings.savedBy' })}
        w={{ base: 140, sm: 200 }}
        value={person}
        onChange={(value) => setPerson(value ?? 'everyone')}
        data={[
          {
            value: 'everyone',
            label: intl.formatMessage({ id: 'viewings.everyone' }),
          },
          { value: 'mine', label: intl.formatMessage({ id: 'viewings.mine' }) },
          ...snapshot.members.map((member) => ({
            value: member.userId,
            label: member.displayName,
          })),
        ]}
      />
      {days.length === 0 ? (
        <Text>
          <FormattedMessage id="viewings.noSavedHomeHasAnUpcomingViewingSaveHomes" />
        </Text>
      ) : (
        days.map((day) => (
          <Stack key={day.day} gap="xs" component="section">
            <Title order={3} size="h4">
              {day.label}
            </Title>
            <Box className={classes.viewingList}>
              {day.entries.map(({ listing, viewing }) => (
                <Box
                  key={`${listing.id}-${viewing.startsAt}`}
                  className={`${classes.card} ${classes.viewingCard}`}
                >
                  <Box className={classes.viewingThumb}>
                    <ListingPhoto listing={listing} />
                  </Box>
                  <Stack gap={4} className={classes.grow}>
                    <Text size="md" fw={800} className={classes.viewingTag}>
                      {formatViewing(viewing, intl)}
                    </Text>
                    <Text fw={600}>{listing.title}</Text>
                    <Text size="sm" c="dimmed">
                      <FormattedMessage
                        id="viewings.savedBy2"
                        values={{ value0: messageValue(names(listing.id)) }}
                      />
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
                      <FormattedMessage id="viewings.originalListing" />
                    </Anchor>
                  </Group>
                </Box>
              ))}
            </Box>
          </Stack>
        ))
      )}
      <Text size="sm" c="dimmed">
        <FormattedMessage
          id="viewings.aViewingCanBeCancelledOrMovedBetweenScans"
          values={{
            value0: messageValue(
              snapshot.edition
                ? intl.formatMessage(
                    { id: 'viewings.updated' },
                    {
                      value0: messageValue(
                        formatDate(snapshot.edition.publishedAt, intl),
                      ),
                    },
                  )
                : '',
            ),
          }}
        />
      </Text>
    </Stack>
  );
}
