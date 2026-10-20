import { Anchor, Divider, Paper, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

import styles from '@/features/house-scanner/components/household-workspace.module.css';
import { ListingNotes } from '@/features/house-scanner/components/listing-notes';
import { ViewingRows } from '@/features/house-scanner/components/viewing-list';
import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
import type {
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import {
  formatDate,
  formatFee,
  formatPrice,
} from '@/features/house-scanner/utils/format';
import { listingNeighborhoodLabel } from '@/features/house-scanner/utils/listing-neighborhoods';
import { hasPin } from '@/features/house-scanner/utils/listing-position';
import { upcomingViewings } from '@/features/house-scanner/utils/viewings';

interface ListingDetailsProps {
  listing: Listing;
  snapshot: Snapshot;
  userId: string;
  notes?: ListingNotesController;
  // The level of the section headings, one below the title above them.
  headingOrder?: 3 | 4;
}

const yesNo = (value: boolean | null) =>
  value === null ? null : value ? 'Yes' : 'No';

const OUTDOOR = {
  balcony: 'Balcony',
  terrace: 'Terrace',
  both: 'Balcony and terrace',
  none: 'None',
} as const;

const TENURE = {
  cooperative: 'Cooperative (bostadsrätt)',
  ownership: 'Owned',
  rental: 'Rental',
  unknown: null,
} as const;

const capitalized = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

// A label and its value on one line each. An unknown value is dimmed, so what is missing stands out.
function FactList({ rows }: { rows: [string, ReactNode | null][] }) {
  return (
    <dl className={styles.factList}>
      {rows.map(([label, value]) => (
        <div key={label} className={styles.factRow}>
          <dt>{label}</dt>
          <dd>
            {value ?? (
              <Text span size="sm" c="dimmed">
                Unknown
              </Text>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section({
  title,
  order,
  children,
}: {
  title: string;
  order: 4 | 5;
  children: ReactNode;
}) {
  return (
    <>
      <Divider />
      <Stack gap="xs">
        <Title order={order} size="h5">
          {title}
        </Title>
        {children}
      </Stack>
    </>
  );
}

export function ListingDetails({
  listing,
  snapshot,
  userId,
  notes,
  headingOrder = 4,
}: ListingDetailsProps) {
  const { facts, conflicts } = listing;
  const house = facts.propertyType === 'house';
  const sectionOrder = headingOrder === 3 ? 4 : 5;
  const timestamps = [
    { label: 'First found', value: listing.firstSeenAt },
    { label: 'Last changed', value: listing.lastChangedAt },
    { label: 'Last checked', value: listing.lastCheckedAt },
  ];
  const floor =
    facts.groundFloor === null
      ? null
      : facts.groundFloor
        ? 'Ground floor'
        : 'Above ground floor';
  return (
    <>
      {listing.delistedAt && (
        <Paper withBorder p="sm" role="note" aria-label="No longer listed">
          <Text size="sm">
            No longer listed since {formatDate(listing.delistedAt)}: the source
            stopped showing it in two full reads in a row. Last seen{' '}
            {formatDate(listing.observedAt)}.
          </Text>
        </Paper>
      )}
      <Title order={headingOrder} size="h4">
        Facts and source evidence
      </Title>
      <Stack gap="md">
        <FactList
          rows={[
            [
              'Asking price',
              facts.askingPriceSek === null
                ? null
                : formatPrice(facts.askingPriceSek),
            ],
            [
              'Monthly fee',
              house
                ? 'Not applicable to a house'
                : facts.baseFeeSek === null
                  ? null
                  : formatFee(facts.baseFeeSek),
            ],
            ...(house
              ? []
              : ([
                  [
                    'Mandatory additions',
                    facts.mandatoryMonthlySek === null
                      ? null
                      : formatFee(facts.mandatoryMonthlySek),
                  ],
                ] as [string, string | null][])),
            [
              'Living area',
              facts.livingAreaM2 === null ? null : `${facts.livingAreaM2} m²`,
            ],
            ['Rooms', facts.rooms === null ? null : String(facts.rooms)],
            [
              'Home type',
              facts.propertyType === null
                ? null
                : capitalized(facts.propertyType),
            ],
            ['Tenure', TENURE[facts.tenure]],
            [
              'Status',
              facts.status === 'unknown' ? null : capitalized(facts.status),
            ],
          ]}
        />
        {conflicts.length > 0 && (
          <Text size="sm">Conflicting fields: {conflicts.join(', ')}</Text>
        )}
        {upcomingViewings(listing, Date.now()).length > 0 && (
          <Section title="Viewings" order={sectionOrder}>
            <ViewingRows listing={listing} />
          </Section>
        )}
        <Section title="Building and outdoor" order={sectionOrder}>
          <FactList
            rows={[
              ['Floor', floor],
              ['Lift', yesNo(facts.lift)],
              [
                'Outdoor space',
                facts.outdoor === null ? null : OUTDOOR[facts.outdoor],
              ],
              ['Glazed outdoor space', yesNo(facts.glazed)],
            ]}
          />
        </Section>
        <Section title="Location" order={sectionOrder}>
          <FactList
            rows={[
              ['Municipality', facts.municipality],
              ['Neighborhood', listingNeighborhoodLabel(listing)],
              [
                'Position',
                listing.coordinates
                  ? `${capitalized(listing.coordinates.precision.replaceAll('_', ' '))}, from ${listing.coordinates.source}, observed ${formatDate(listing.coordinates.observedAt)}`
                  : null,
              ],
            ]}
          />
          {listing.coordinates && !hasPin(listing.coordinates) && (
            <Text size="sm">Approximate area; no exact pin is shown.</Text>
          )}
          {!listing.coordinates && (
            <Text size="sm">Listed without a map position.</Text>
          )}
        </Section>
        <Section title="Source" order={sectionOrder}>
          <FactList
            rows={[
              ['Last observed', formatDate(listing.observedAt)],
              ...timestamps.flatMap(({ label, value }) =>
                value
                  ? ([[label, formatDate(value)]] as [string, string][])
                  : [],
              ),
              ...(listing.userTags.length > 0
                ? ([['Tags', listing.userTags.join(', ')]] as [
                    string,
                    string,
                  ][])
                : []),
            ]}
          />
          {listing.sourceUrls.map((url) => (
            <Anchor
              key={url}
              size="sm"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              {new URL(url).hostname}: original listing
            </Anchor>
          ))}
        </Section>
        <Section title="Evidence" order={sectionOrder}>
          {listing.evidence.length ? (
            listing.evidence.map((evidence) => (
              <Stack key={evidence.id} gap={4}>
                <Text size="sm">
                  {evidence.kind.replaceAll('_', ' ')} ·{' '}
                  {evidence.subject.replaceAll('_', ' ')}: {evidence.summary}
                </Text>
                <Text size="xs">
                  {formatDate(evidence.observedAt)}
                  {evidence.method ? ` · ${evidence.method}` : ''}
                </Text>
                {evidence.sourceUrl && (
                  <Anchor
                    size="sm"
                    href={evidence.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Evidence source
                  </Anchor>
                )}
              </Stack>
            ))
          ) : (
            <Text size="sm">
              No supporting nature, transit or other evidence recorded.
            </Text>
          )}
        </Section>
        <Divider />
        <Title order={headingOrder} size="h4">
          Notes
        </Title>
        <ListingNotes
          controller={notes}
          members={snapshot.members}
          userId={userId}
        />
      </Stack>
    </>
  );
}
