import {
  Anchor,
  Divider,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import type { ReactNode } from 'react';
import { FormattedMessage, type IntlShape, useIntl } from 'react-intl';
import { ListingNotes } from '@/features/house-scanner/components/listing-notes';
import { ManualListingActions } from '@/features/house-scanner/components/manual-listing-actions';
import { ViewingRows } from '@/features/house-scanner/components/viewing-list';
import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
import {
  englishIntl,
  messageValue,
} from '@/features/house-scanner/i18n/catalogs';
import { displayLabel } from '@/features/house-scanner/i18n/display-labels';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
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

const yesNo = (value: boolean | null, intl: IntlShape = englishIntl) =>
  value === null
    ? null
    : value
      ? intl.formatMessage({ id: 'common.yes' })
      : intl.formatMessage({ id: 'common.no' });

const OUTDOOR = (intl: IntlShape) =>
  ({
    balcony: intl.formatMessage({ id: 'listings.details.balcony' }),
    terrace: intl.formatMessage({ id: 'listings.details.terrace' }),
    both: intl.formatMessage({ id: 'listings.details.balconyAndTerrace' }),
    none: intl.formatMessage({ id: 'common.none' }),
  }) as const;

const TENURE = (intl: IntlShape) =>
  ({
    cooperative: intl.formatMessage({
      id: 'listings.details.cooperativeBostadsratt',
    }),
    ownership: intl.formatMessage({ id: 'listings.details.owned' }),
    rental: intl.formatMessage({ id: 'listings.details.rental' }),
    unknown: null,
  }) as const;

// A label and its value on one line each. An unknown value is dimmed, so what is missing stands out.
function FactList({ rows }: { rows: [string, ReactNode | null][] }) {
  return (
    <dl className={classes.factList}>
      {rows.map(([label, value]) => (
        <div key={label} className={classes.factRow}>
          <dt>{label}</dt>
          <dd>
            {value ?? (
              <Text span size="sm" c="dimmed">
                <FormattedMessage id="common.unknown" />
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
  const intl = useIntl();

  const { facts, conflicts } = listing;
  const house = facts.propertyType === 'house';
  const sectionOrder = headingOrder === 3 ? 4 : 5;
  const timestamps = [
    {
      label: intl.formatMessage({ id: 'listings.details.firstFound' }),
      value: listing.firstSeenAt,
    },
    {
      label: intl.formatMessage({ id: 'listings.details.lastChanged' }),
      value: listing.lastChangedAt,
    },
    {
      label: intl.formatMessage({ id: 'listings.details.lastChecked' }),
      value: listing.lastCheckedAt,
    },
  ];
  const floor =
    facts.groundFloor === null
      ? null
      : facts.groundFloor
        ? intl.formatMessage({ id: 'listings.details.groundFloor' })
        : intl.formatMessage({ id: 'listings.details.aboveGroundFloor' });
  return (
    <>
      {listing.delistedAt && (
        <Paper
          withBorder
          p="sm"
          role="note"
          aria-label={intl.formatMessage({
            id: 'listings.details.noLongerListed',
          })}
        >
          <Text size="sm">
            <FormattedMessage
              id="listings.details.noLongerListedSinceTheSourceStoppedShowingIt"
              values={{
                value0: messageValue(formatDate(listing.delistedAt, intl)),
                value1: messageValue(formatDate(listing.observedAt, intl)),
              }}
            />
          </Text>
        </Paper>
      )}
      <Title order={headingOrder} size="h4">
        <FormattedMessage id="listings.details.factsAndSourceEvidence" />
      </Title>
      <ManualListingActions listing={listing} />
      <Stack gap="md">
        <FactList
          rows={[
            [
              intl.formatMessage({ id: 'listings.details.askingPrice' }),
              facts.askingPriceSek === null
                ? null
                : formatPrice(facts.askingPriceSek, intl),
            ],
            [
              intl.formatMessage({ id: 'listings.details.monthlyFee' }),
              house
                ? intl.formatMessage({
                    id: 'listings.details.notApplicableToAHouse',
                  })
                : facts.baseFeeSek === null
                  ? null
                  : formatFee(facts.baseFeeSek, intl),
            ],
            ...(house
              ? []
              : ([
                  [
                    intl.formatMessage({
                      id: 'listings.details.mandatoryAdditions',
                    }),
                    facts.mandatoryMonthlySek === null
                      ? null
                      : formatFee(facts.mandatoryMonthlySek, intl),
                  ],
                ] as [string, string | null][])),
            [
              intl.formatMessage({ id: 'listings.details.livingArea' }),
              facts.livingAreaM2 === null
                ? null
                : intl.formatMessage(
                    { id: 'listings.details.m' },
                    {
                      value0: messageValue(
                        intl.formatNumber(facts.livingAreaM2),
                      ),
                    },
                  ),
            ],
            [
              intl.formatMessage({ id: 'listings.details.rooms' }),
              facts.rooms === null ? null : intl.formatNumber(facts.rooms),
            ],
            [
              intl.formatMessage({ id: 'listings.details.homeType' }),
              facts.propertyType === null
                ? null
                : displayLabel(intl, facts.propertyType),
            ],
            [
              intl.formatMessage({ id: 'listings.details.tenure' }),
              TENURE(intl)[facts.tenure],
            ],
            [
              intl.formatMessage({ id: 'listings.details.status' }),
              facts.status === 'unknown'
                ? null
                : displayLabel(intl, facts.status),
            ],
          ]}
        />
        {conflicts.length > 0 && (
          <Text size="sm">
            <FormattedMessage
              id="listings.details.conflictingFields"
              values={{
                value0: messageValue(
                  intl.formatList(
                    conflicts.map((field) => displayLabel(intl, field)),
                  ),
                ),
              }}
            />
          </Text>
        )}
        {upcomingViewings(listing, Date.now()).length > 0 && (
          <Section
            title={intl.formatMessage({ id: 'listings.details.viewings' })}
            order={sectionOrder}
          >
            <ViewingRows listing={listing} />
          </Section>
        )}
        {listing.photos && listing.photos.length > 1 && (
          <Section
            title={intl.formatMessage({ id: 'listings.details.photos' })}
            order={sectionOrder}
          >
            <Group gap="xs">
              {listing.photos.map((photo) => (
                <a
                  key={photo.url}
                  href={listing.sourceUrls[0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  <img
                    src={photo.url}
                    alt={listing.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    width={160}
                    height={107}
                    style={{ objectFit: 'cover' }}
                  />
                </a>
              ))}
            </Group>
          </Section>
        )}
        <Section
          title={intl.formatMessage({
            id: 'listings.details.buildingAndOutdoor',
          })}
          order={sectionOrder}
        >
          <FactList
            rows={[
              [intl.formatMessage({ id: 'listings.details.floor' }), floor],
              [
                intl.formatMessage({ id: 'listings.details.lift' }),
                yesNo(facts.lift, intl),
              ],
              [
                intl.formatMessage({ id: 'listings.details.outdoorSpace' }),
                facts.outdoor === null ? null : OUTDOOR(intl)[facts.outdoor],
              ],
              [
                intl.formatMessage({
                  id: 'listings.details.glazedOutdoorSpace',
                }),
                yesNo(facts.glazed, intl),
              ],
            ]}
          />
        </Section>
        <Section
          title={intl.formatMessage({ id: 'listings.details.location' })}
          order={sectionOrder}
        >
          <FactList
            rows={[
              [
                intl.formatMessage({ id: 'listings.details.municipality' }),
                facts.municipality,
              ],
              [
                intl.formatMessage({ id: 'listings.details.neighborhood' }),
                listingNeighborhoodLabel(listing),
              ],
              [
                intl.formatMessage({ id: 'listings.details.position' }),
                listing.coordinates
                  ? intl.formatMessage(
                      { id: 'listings.details.fromObserved' },
                      {
                        value0: messageValue(
                          displayLabel(intl, listing.coordinates.precision),
                        ),
                        value1: messageValue(
                          displayLabel(intl, listing.coordinates.source),
                        ),
                        value2: messageValue(
                          formatDate(listing.coordinates.observedAt, intl),
                        ),
                      },
                    )
                  : null,
              ],
            ]}
          />
          {listing.coordinates && !hasPin(listing.coordinates) && (
            <Text size="sm">
              <FormattedMessage id="listings.details.approximateAreaNoExactPinIsShown" />
            </Text>
          )}
          {!listing.coordinates && (
            <Text size="sm">
              <FormattedMessage id="listings.details.listedWithoutAMapPosition" />
            </Text>
          )}
        </Section>
        <Section
          title={intl.formatMessage({ id: 'listings.details.source' })}
          order={sectionOrder}
        >
          <FactList
            rows={[
              [
                intl.formatMessage({ id: 'listings.details.lastObserved' }),
                formatDate(listing.observedAt, intl),
              ],
              ...(listing.origin === 'manual' &&
              [
                facts.propertyType,
                facts.askingPriceSek,
                facts.livingAreaM2,
                facts.rooms,
                facts.outdoor,
              ].some((fact) => fact !== null)
                ? ([
                    [
                      intl.formatMessage({ id: 'listings.details.facts' }),
                      intl.formatMessage({
                        id: 'listings.details.enteredByAMember',
                      }),
                    ],
                  ] as [string, string][])
                : []),
              ...timestamps.flatMap(({ label, value }) =>
                value
                  ? ([[label, formatDate(value, intl)]] as [string, string][])
                  : [],
              ),
              ...(listing.userTags.length > 0
                ? ([
                    [
                      intl.formatMessage({ id: 'listings.details.tags' }),
                      listing.userTags.join(', '),
                    ],
                  ] as [string, string][])
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
              <FormattedMessage
                id="listings.details.originalListing"
                values={{ value0: messageValue(new URL(url).hostname) }}
              />
            </Anchor>
          ))}
        </Section>
        <Section
          title={intl.formatMessage({ id: 'listings.details.evidence' })}
          order={sectionOrder}
        >
          {listing.evidence.length ? (
            listing.evidence.map((evidence) => (
              <Stack key={evidence.id} gap={4}>
                <Text size="sm">
                  {displayLabel(intl, evidence.kind)} ·{' '}
                  {displayLabel(intl, evidence.subject)}: {evidence.summary}
                </Text>
                <Text size="xs">
                  {formatDate(evidence.observedAt, intl)}
                  {evidence.method ? ` · ${evidence.method}` : ''}
                </Text>
                {evidence.sourceUrl && (
                  <Anchor
                    size="sm"
                    href={evidence.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <FormattedMessage id="listings.details.evidenceSource" />
                  </Anchor>
                )}
              </Stack>
            ))
          ) : (
            <Text size="sm">
              <FormattedMessage id="listings.details.noSupportingNatureTransitOrOtherEvidenceRecorded" />
            </Text>
          )}
        </Section>
        <Divider />
        <Title order={headingOrder} size="h4">
          <FormattedMessage id="listings.details.notes" />
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
