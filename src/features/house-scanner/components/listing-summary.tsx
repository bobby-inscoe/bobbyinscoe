import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { FormattedMessage, useIntl } from 'react-intl';
import { messageValue } from '@/features/house-scanner/i18n/catalogs';
import { displayLabel } from '@/features/house-scanner/i18n/display-labels';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type {
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import { formatFee, formatPrice } from '@/features/house-scanner/utils/format';
import { listingNeighborhoodLabel } from '@/features/house-scanner/utils/listing-neighborhoods';
import { estimatedPositionLabel } from '@/features/house-scanner/utils/listing-position';
import {
  listingMatches,
  reasonChips,
  SECTION_LABELS,
} from '@/features/house-scanner/utils/match-listing';

// The lines the list card and the details sheet share.
export function PriceLine({ listing }: { listing: Listing }) {
  const intl = useIntl();

  const current = listing.facts.askingPriceSek;
  const previous = listing.previousAskingPriceSek;
  const changed =
    previous !== null &&
    current !== null &&
    previous !== current &&
    !listing.conflicts.includes('askingPriceSek');
  return (
    <Text fz="1.5rem" className={classes.priceText}>
      {changed && (
        <>
          <s>{formatPrice(previous, intl)}</s>{' '}
          <span
            className={current < previous ? classes.priceDown : classes.priceUp}
            role="img"
            aria-label={
              current < previous
                ? intl.formatMessage({ id: 'listings.details.priceDecreased' })
                : intl.formatMessage({ id: 'listings.details.priceIncreased' })
            }
          >
            {current < previous ? (
              <ArrowDown size="0.85em" strokeWidth={3} aria-hidden />
            ) : (
              <ArrowUp size="0.85em" strokeWidth={3} aria-hidden />
            )}
          </span>{' '}
        </>
      )}
      <span className={classes.priceNow}>{formatPrice(current, intl)}</span>
      {listing.conflicts.includes('askingPriceSek') &&
        intl.formatMessage({ id: 'listings.details.disputed' })}
    </Text>
  );
}

/** Compact facts shared by list cards, details and map previews. */
export function KeyFacts({ listing }: { listing: Listing }) {
  const intl = useIntl();

  const { facts, conflicts } = listing;
  const neighborhood = listingNeighborhoodLabel(listing);
  const disputed = (key: 'livingAreaM2' | 'rooms' | 'baseFeeSek') =>
    conflicts.includes(key) &&
    intl.formatMessage({ id: 'listings.details.disputed' });
  // A house has no monthly fee, so only a flat with none on record says so.
  const fee =
    facts.baseFeeSek !== null
      ? formatFee(facts.baseFeeSek, intl)
      : facts.propertyType === 'house'
        ? null
        : intl.formatMessage({ id: 'listings.details.feeUnknown' });
  return (
    <Text size="sm" fw={600}>
      <FormattedMessage
        id="listings.details.roomFacts"
        values={{
          area:
            facts.livingAreaM2 === null
              ? intl.formatMessage({ id: 'common.unknown' })
              : intl.formatNumber(facts.livingAreaM2),
          areaDisputed: messageValue(disputed('livingAreaM2')),
          rooms:
            facts.rooms === null
              ? intl.formatMessage({ id: 'common.unknown' })
              : intl.formatMessage(
                  { id: 'listings.details.roomCount' },
                  { count: facts.rooms },
                ),
          roomsDisputed: messageValue(disputed('rooms')),
          fee: fee === null ? '' : ` · ${fee}`,
          feeDisputed: messageValue(
            facts.baseFeeSek !== null && disputed('baseFeeSek'),
          ),
          neighborhood: neighborhood ? ` · ${neighborhood}` : '',
        }}
      />
    </Text>
  );
}

/** Names the other sites that carry the same home, when the list has folded their copies into this one. */
export function AlsoOn({ sites }: { sites?: string[] }) {
  if (!sites?.length) return null;
  return (
    <Text size="sm" c="dimmed">
      <FormattedMessage
        id="listings.details.alsoOn"
        values={{ value0: messageValue(sites.join(', ')) }}
      />
    </Text>
  );
}

export function FactsLine({ listing }: { listing: Listing }) {
  const intl = useIntl();

  const estimated = estimatedPositionLabel(listing.coordinates, intl);
  return (
    <>
      <KeyFacts listing={listing} />
      <Text size="sm" c="dimmed">
        {listing.facts.propertyType
          ? displayLabel(intl, listing.facts.propertyType)
          : intl.formatMessage({ id: 'listings.details.typeUnknown' })}
        {listing.conflicts.includes('propertyType') &&
          intl.formatMessage({ id: 'listings.details.disputed' })}
        {estimated && ` · ${estimated}`}
      </Text>
    </>
  );
}

// Plain facts about the home. No score; they only say what is known.
export function ReasonChips({ listing }: { listing: Listing }) {
  const intl = useIntl();

  const facts = reasonChips(listing, intl);
  if (!facts.length) return null;
  return (
    <Group gap={4}>
      {facts.map((chip) => (
        <Badge key={chip} variant="light" tt="none">
          {chip}
        </Badge>
      ))}
    </Group>
  );
}

interface MatchLinesProps {
  listing: Listing;
  snapshot: Snapshot;
  // Adds the reasons and caveats behind each label.
  details?: boolean;
}

export function MatchLines({ listing, snapshot, details }: MatchLinesProps) {
  const intl = useIntl();

  const matches = listingMatches(listing, snapshot, intl);
  return (
    <>
      {matches.map(({ profile, result }) => (
        <Stack key={profile.id} gap={4}>
          <Text size="sm" fw={600}>
            {matches.length > 1 && `${profile.name}: `}
            {SECTION_LABELS(intl)[result.section]}
            {result.missing.length > 0 && `: ${result.missing.join(', ')}`}
          </Text>
          {details && (
            <>
              <Text size="sm">{result.reasons.join('; ')}</Text>
              <Text size="sm" c="dimmed">
                {result.caveats.join('; ')}
              </Text>
            </>
          )}
        </Stack>
      ))}
      {matches.length === 0 && (
        <Text size="sm">
          <FormattedMessage id="listings.details.noEnabledSearchProfilesThisHomeHasNotBeen" />
        </Text>
      )}
    </>
  );
}

export function OriginalListingButton({ listing }: { listing: Listing }) {
  return (
    <Button
      component="a"
      size="xs"
      variant="default"
      href={listing.sourceUrls[0]}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      // The global `a { color: inherit }` rule would otherwise override the button's label color.
      c="var(--button-color)"
      td="none"
    >
      <FormattedMessage id="listings.details.openOriginalListing" />
    </Button>
  );
}
