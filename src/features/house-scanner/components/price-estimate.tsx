import { Text, Tooltip } from '@mantine/core';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { messageValue } from '@/features/house-scanner/i18n/catalogs';

import type { Listing } from '@/features/house-scanner/types/contracts';
import { compactPrice } from '@/features/house-scanner/utils/format';
import {
  estimatePrices,
  type PriceEstimate,
} from '@/features/house-scanner/utils/price-estimate';

const Estimates = createContext<ReadonlyMap<string, PriceEstimate>>(new Map());

/** Computes the range for every home with no price once per snapshot, for the cards that show it. */
export function PriceEstimateProvider({
  listings,
  children,
}: {
  listings: Listing[];
  children: ReactNode;
}) {
  const estimates = useMemo(() => estimatePrices(listings), [listings]);
  return <Estimates.Provider value={estimates}>{children}</Estimates.Provider>;
}

/** True when the home has no asking price and the range stands in for it. */
export function useHasEstimate(listing: Listing) {
  return useContext(Estimates).has(listing.id);
}

/** The range for a home with no asking price, if it has one. */
export function usePriceEstimate(listing: Listing) {
  return useContext(Estimates).get(listing.id);
}

/** "Estimate 3,9M–5,3M": a guide for a home with no asking price, and how it was worked out. */
export function EstimateLine({ listing }: { listing: Listing }) {
  const intl = useIntl();

  const estimate = useContext(Estimates).get(listing.id);
  if (!estimate) return null;
  const kilometres = intl.formatNumber(estimate.farthestM / 1000, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return (
    <Tooltip
      multiline
      w={280}
      events={{ hover: true, focus: true, touch: true }}
      label={intl.formatMessage(
        { id: 'listings.details.workedOutFromTheAskingPricesOfTheNearest' },
        {
          value0: messageValue(estimate.basedOn),
          value1: messageValue(kilometres),
        },
      )}
    >
      <Text size="sm" fw={600} tabIndex={0}>
        <FormattedMessage id="listings.details.estimate" />{' '}
        {compactPrice(estimate.lowSek, intl)}–
        {compactPrice(estimate.highSek, intl)}
        <Text span size="sm" c="dimmed" fw={400}>
          {' '}
          <FormattedMessage
            id="listings.details.fromNearbyAskingPrices"
            values={{ value0: messageValue(estimate.basedOn) }}
          />
        </Text>
      </Text>
    </Tooltip>
  );
}
