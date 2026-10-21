import { Badge, Button, Group, Stack, Text } from '@mantine/core';

import { ArrowDown, ArrowUp } from 'lucide-react';
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
          <s>{formatPrice(previous)}</s>{' '}
          <span
            className={current < previous ? classes.priceDown : classes.priceUp}
            role="img"
            aria-label={
              current < previous ? 'Price decreased' : 'Price increased'
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
      <span className={classes.priceNow}>{formatPrice(current)}</span>
      {listing.conflicts.includes('askingPriceSek') && ' (disputed)'}
    </Text>
  );
}

/** Compact facts shared by list cards, details and map previews. */
export function KeyFacts({ listing }: { listing: Listing }) {
  const { facts, conflicts } = listing;
  const neighborhood = listingNeighborhoodLabel(listing);
  const disputed = (key: 'livingAreaM2' | 'rooms' | 'baseFeeSek') =>
    conflicts.includes(key) && ' (disputed)';
  // A house has no monthly fee, so only a flat with none on record says so.
  const fee =
    facts.baseFeeSek !== null
      ? formatFee(facts.baseFeeSek)
      : facts.propertyType === 'house'
        ? null
        : 'Fee unknown';
  return (
    <Text size="sm" fw={600}>
      {facts.livingAreaM2 ?? 'Unknown'} m²{disputed('livingAreaM2')} ·{' '}
      {facts.rooms ?? 'Unknown'} rooms{disputed('rooms')}
      {fee !== null && ` · ${fee}`}
      {facts.baseFeeSek !== null && disputed('baseFeeSek')}
      {neighborhood && ` · ${neighborhood}`}
    </Text>
  );
}

/** Names the other sites that carry the same home, when the list has folded their copies into this one. */
export function AlsoOn({ sites }: { sites?: string[] }) {
  if (!sites?.length) return null;
  return (
    <Text size="sm" c="dimmed">
      Also on {sites.join(', ')}
    </Text>
  );
}

export function FactsLine({ listing }: { listing: Listing }) {
  const estimated = estimatedPositionLabel(listing.coordinates);
  return (
    <>
      <KeyFacts listing={listing} />
      <Text size="sm" c="dimmed">
        {listing.facts.propertyType ?? 'Type unknown'}
        {listing.conflicts.includes('propertyType') && ' (disputed)'}
        {estimated && ` · ${estimated}`}
      </Text>
    </>
  );
}

// Plain facts about the home. No score; they only say what is known.
export function ReasonChips({ listing }: { listing: Listing }) {
  const facts = reasonChips(listing);
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
  const matches = listingMatches(listing, snapshot);
  return (
    <>
      {matches.map(({ profile, result }) => (
        <Stack key={profile.id} gap={4}>
          <Text size="sm" fw={600}>
            {matches.length > 1 && `${profile.name}: `}
            {SECTION_LABELS[result.section]}
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
          No enabled search profiles. This home has not been matched.
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
      Open original listing
    </Button>
  );
}
