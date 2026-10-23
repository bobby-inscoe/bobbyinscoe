import {
  ActionIcon,
  Button,
  Divider,
  Group,
  Paper,
  Popover,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { ExternalLink, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { FormattedMessage, type IntlShape, useIntl } from 'react-intl';
import { ListingNotes } from '@/features/house-scanner/components/listing-notes';
import { ManualListingActions } from '@/features/house-scanner/components/manual-listing-actions';
import { ViewingRows } from '@/features/house-scanner/components/viewing-list';
import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
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
import { sourceName } from '@/features/house-scanner/utils/source-name';
import { upcomingViewings } from '@/features/house-scanner/utils/viewings';

interface ListingDetailsProps {
  listing: Listing;
  snapshot: Snapshot;
  userId: string;
  notes?: ListingNotesController;
  headingOrder?: 3 | 4;
  onSelectPhoto?: (index: number) => void;
  locationPreview?: ReactNode;
  monthlyCost?: ReactNode;
}

interface FactRow {
  field?: keyof Listing['facts'];
  label: string;
  value: ReactNode | null;
  disputed?: boolean;
  note?: ReactNode;
}

function FactList({ rows }: { rows: FactRow[] }) {
  return (
    <dl className={classes.factList}>
      {rows.map(({ label, value, disputed, note }) => (
        <div key={label} className={classes.factRow}>
          <dt>{label}</dt>
          <dd>
            {value ?? (
              <Text span c="orange.8">
                <FormattedMessage id="common.unknown" />
              </Text>
            )}
            {disputed && (
              <Text span c="orange.8">
                <FormattedMessage id="listings.details.disputed" />
              </Text>
            )}
            {note && (
              <Text component="div" size="sm" c="orange.8">
                {note}
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

const yesNo = (value: boolean | null, intl: IntlShape) =>
  value === null
    ? null
    : intl.formatMessage({ id: value ? 'common.yes' : 'common.no' });

export function ListingDetails({
  listing,
  snapshot,
  userId,
  notes,
  headingOrder = 4,
  onSelectPhoto,
  locationPreview,
  monthlyCost,
}: ListingDetailsProps) {
  const intl = useIntl();
  const { facts, conflicts } = listing;
  const house = facts.propertyType === 'house';
  const sectionOrder = headingOrder === 3 ? 4 : 5;
  const fact = (
    field: keyof Listing['facts'],
    value: ReactNode | null,
    note?: ReactNode,
  ): FactRow => ({
    field,
    label: displayLabel(intl, field),
    value,
    disputed: conflicts.includes(field),
    note,
  });
  const known = (field: keyof Listing['facts']) =>
    facts[field] != null || conflicts.includes(field);
  const profiles = snapshot.profiles.filter((profile) => profile.enabled);
  const feeWarnings = (total: boolean) => {
    const baseFee = facts.baseFeeSek;
    if (
      facts.propertyType !== 'apartment' ||
      conflicts.includes('propertyType') ||
      baseFee === null ||
      conflicts.includes('baseFeeSek') ||
      (total &&
        (facts.mandatoryMonthlySek === null ||
          conflicts.includes('mandatoryMonthlySek')))
    )
      return null;
    const amount = baseFee + (total ? (facts.mandatoryMonthlySek ?? 0) : 0);
    const warnings = profiles
      .filter(
        ({ criteria }) =>
          amount > criteria.feeReferenceSek &&
          (!total || baseFee <= criteria.feeReferenceSek),
      )
      .map((profile) => (
        <span key={profile.id}>
          {profiles.length > 1 && `${profile.name}: `}
          {intl.formatMessage(
            {
              id: total
                ? 'listings.details.totalAbovePreference'
                : 'listings.details.abovePreference',
            },
            { value0: formatFee(profile.criteria.feeReferenceSek, intl) },
          )}
        </span>
      ));
    return warnings.length ? <Stack gap={2}>{warnings}</Stack> : null;
  };
  const floor =
    facts.groundFloor === null
      ? null
      : intl.formatMessage({
          id: facts.groundFloor
            ? 'listings.details.groundFloor'
            : 'listings.details.aboveGroundFloor',
        });
  const outdoor =
    facts.outdoor === null
      ? null
      : intl.formatMessage({
          id: (
            {
              balcony: 'listings.details.balcony',
              terrace: 'listings.details.terrace',
              both: 'listings.details.balconyAndTerrace',
              none: 'common.none',
            } as const
          )[facts.outdoor],
        });
  const timestamps = [
    {
      label: intl.formatMessage({ id: 'listings.details.lastChanged' }),
      value: listing.lastChangedAt,
    },
    {
      label: intl.formatMessage({ id: 'listings.details.lastChecked' }),
      value: listing.lastCheckedAt ?? listing.observedAt,
    },
  ].filter((item): item is { label: string; value: string } => !!item.value);
  const [primaryTime, ...otherTimes] = timestamps;
  const floorPlan =
    listing.floorPlan && Date.parse(listing.floorPlan.expiresAt) > Date.now()
      ? listing.floorPlan
      : null;
  const mainFacts = [
    fact(
      'livingAreaM2',
      facts.livingAreaM2 === null
        ? null
        : intl.formatMessage(
            { id: 'listings.details.m' },
            { value0: intl.formatNumber(facts.livingAreaM2) },
          ),
    ),
    fact('rooms', facts.rooms === null ? null : intl.formatNumber(facts.rooms)),
    ...(!house || known('baseFeeSek')
      ? [
          fact(
            'baseFeeSek',
            facts.baseFeeSek === null
              ? null
              : formatFee(facts.baseFeeSek, intl),
            feeWarnings(false),
          ),
        ]
      : []),
  ];
  const activeBidding =
    facts.bidding === true &&
    !conflicts.includes('bidding') &&
    !conflicts.includes('status') &&
    !listing.delistedAt &&
    facts.status !== 'sold' &&
    facts.status !== 'withdrawn';
  const secondaryFacts = [
    ...(facts.status !== 'unknown' ||
    activeBidding ||
    conflicts.includes('status') ||
    conflicts.includes('bidding')
      ? [
          {
            ...fact(
              'status',
              activeBidding
                ? intl.formatMessage({ id: 'listings.details.biddingUnderWay' })
                : facts.status === 'unknown'
                  ? null
                  : displayLabel(intl, facts.status),
            ),
            disputed:
              conflicts.includes('status') || conflicts.includes('bidding'),
          },
        ]
      : []),
    ...(facts.purchase !== true || conflicts.includes('purchase')
      ? [fact('purchase', yesNo(facts.purchase, intl))]
      : []),
    ...(known('mandatoryMonthlySek')
      ? [
          fact(
            'mandatoryMonthlySek',
            facts.mandatoryMonthlySek === null
              ? null
              : formatFee(facts.mandatoryMonthlySek, intl),
            feeWarnings(true),
          ),
        ]
      : []),
    ...(facts.highestBidSek != null
      ? [
          fact(
            'highestBidSek',
            facts.highestBidSek == null
              ? null
              : formatPrice(facts.highestBidSek, intl),
          ),
        ]
      : []),
  ];
  const buildingFacts = [
    ...(!house || conflicts.includes('groundFloor')
      ? [fact('groundFloor', floor)]
      : []),
    ...(!house || conflicts.includes('lift')
      ? [fact('lift', yesNo(facts.lift, intl))]
      : []),
    fact('outdoor', outdoor),
    ...(known('glazed') ? [fact('glazed', yesNo(facts.glazed, intl))] : []),
    ...(facts.liftServesHome === false || conflicts.includes('liftServesHome')
      ? [fact('liftServesHome', yesNo(facts.liftServesHome, intl))]
      : []),
    ...(facts.stepFree === false || conflicts.includes('stepFree')
      ? [fact('stepFree', yesNo(facts.stepFree, intl))]
      : []),
  ];
  const displayedFields = new Set<keyof Listing['facts']>([
    'askingPriceSek',
    'municipality',
    'propertyType',
    'tenure',
    'bidding',
    'highestBidSek',
    ...[...mainFacts, ...secondaryFacts, ...buildingFacts].flatMap((row) =>
      row.field ? [row.field] : [],
    ),
  ]);
  const otherConflicts = conflicts.filter(
    (field) => !displayedFields.has(field),
  );

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
                value0: formatDate(listing.delistedAt, intl),
                value1: formatDate(listing.observedAt, intl),
              }}
            />
          </Text>
        </Paper>
      )}
      <Title order={headingOrder} size="h4">
        <FormattedMessage id="listings.details.facts" />
      </Title>
      <ManualListingActions listing={listing} />
      <Stack gap="md">
        <FactList rows={mainFacts} />
        {floorPlan && (
          <Section
            title={intl.formatMessage({ id: 'listings.details.floorPlan' })}
            order={sectionOrder}
          >
            {onSelectPhoto ? (
              <UnstyledButton
                onClick={() => onSelectPhoto(-1)}
                aria-label={intl.formatMessage({
                  id: 'listings.details.viewFloorPlan',
                })}
              >
                <img
                  src={floorPlan.url}
                  alt={intl.formatMessage({ id: 'listings.details.floorPlan' })}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  width={480}
                  className={classes.floorPlanPreview}
                />
              </UnstyledButton>
            ) : (
              <img
                src={floorPlan.url}
                alt={intl.formatMessage({ id: 'listings.details.floorPlan' })}
                loading="lazy"
                referrerPolicy="no-referrer"
                width={480}
                className={classes.floorPlanPreview}
              />
            )}
          </Section>
        )}
        {upcomingViewings(listing, Date.now()).length > 0 && (
          <Section
            title={intl.formatMessage({ id: 'listings.details.viewings' })}
            order={sectionOrder}
          >
            <ViewingRows listing={listing} />
          </Section>
        )}
        {(secondaryFacts.length > 0 || otherConflicts.length > 0) && (
          <Section
            title={intl.formatMessage({ id: 'listings.details.details' })}
            order={sectionOrder}
          >
            <FactList
              rows={[
                ...secondaryFacts,
                ...otherConflicts.map((field) =>
                  fact(
                    field,
                    facts[field] == null ? null : String(facts[field]),
                  ),
                ),
              ]}
            />
          </Section>
        )}
        <Section
          title={intl.formatMessage({
            id: 'listings.details.buildingAndOutdoor',
          })}
          order={sectionOrder}
        >
          <FactList rows={buildingFacts} />
        </Section>
        <Section
          title={intl.formatMessage({ id: 'listings.details.location' })}
          order={sectionOrder}
        >
          <FactList
            rows={[
              fact('municipality', facts.municipality),
              {
                label: intl.formatMessage({
                  id: 'listings.details.neighborhood',
                }),
                value: listingNeighborhoodLabel(listing),
              },
              ...(locationPreview !== undefined
                ? []
                : [
                    {
                      label: intl.formatMessage({
                        id: 'listings.details.position',
                      }),
                      value: listing.coordinates
                        ? intl.formatMessage(
                            { id: 'listings.details.fromObserved' },
                            {
                              value0: displayLabel(
                                intl,
                                listing.coordinates.precision,
                              ),
                              value1: displayLabel(
                                intl,
                                listing.coordinates.source,
                              ),
                            },
                          )
                        : null,
                    },
                  ]),
            ]}
          />
          {locationPreview}
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
        {monthlyCost}
        <Section
          title={intl.formatMessage({ id: 'listings.details.source' })}
          order={sectionOrder}
        >
          {listing.sourceUrls.map((url) => (
            <Button
              component="a"
              variant="default"
              size="xs"
              styles={{
                label: { lineHeight: 1 },
                section: { alignItems: 'center' },
              }}
              w="fit-content"
              c="var(--button-color)"
              td="none"
              rightSection={
                <ExternalLink
                  size={14}
                  style={{ display: 'block' }}
                  aria-hidden
                />
              }
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              {sourceName(new URL(url).hostname)}
            </Button>
          ))}
          <Group gap={4} align="center" wrap="nowrap">
            <Text size="sm" c="dimmed" lh={1}>
              {primaryTime.label}: {formatDate(primaryTime.value, intl)}
            </Text>
            {listing.lastChangedAt && (
              <Popover
                width={320}
                position="top"
                withArrow
                trapFocus
                returnFocus
                middlewares={{ shift: { crossAxis: true, padding: 12 } }}
              >
                <Popover.Target>
                  <ActionIcon
                    size="xs"
                    className={classes.inlineHelp}
                    variant="transparent"
                    c="dimmed"
                    aria-label={intl.formatMessage({
                      id: 'listings.details.timestampInfo',
                    })}
                  >
                    <Info
                      size={14}
                      strokeWidth={1.5}
                      style={{ display: 'block' }}
                      aria-hidden
                    />
                  </ActionIcon>
                </Popover.Target>
                <Popover.Dropdown
                  data-mantine-stop-propagation="true"
                  maw="calc(100vw - 24px)"
                >
                  <Stack gap="xs">
                    <Text size="sm">
                      <FormattedMessage id="listings.details.lastChangedScope" />
                    </Text>
                    {otherTimes.map(({ label, value }) => (
                      <Text key={label} size="sm">
                        <span>{label}</span>: {formatDate(value, intl)}
                      </Text>
                    ))}
                  </Stack>
                </Popover.Dropdown>
              </Popover>
            )}
          </Group>
          {listing.origin === 'manual' && (
            <Text size="sm" c="dimmed">
              <FormattedMessage id="listings.details.enteredByAMember" />
            </Text>
          )}
          {listing.userTags.length > 0 && (
            <Text size="sm">{listing.userTags.join(', ')}</Text>
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
