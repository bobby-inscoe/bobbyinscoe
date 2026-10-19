import { Text, Tooltip } from '@mantine/core';
import { createContext, type ReactNode, useContext, useMemo } from 'react';

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

/** "Estimate 3,9M–5,3M": a guide for a home with no asking price, and how it was worked out. */
export function EstimateLine({ listing }: { listing: Listing }) {
  const estimate = useContext(Estimates).get(listing.id);
  if (!estimate) return null;
  const kilometres = (estimate.farthestM / 1000).toFixed(1).replace('.', ',');
  return (
    <Tooltip
      multiline
      w={280}
      events={{ hover: true, focus: true, touch: true }}
      label={`Worked out from the asking prices of the ${estimate.basedOn} nearest apartments that have one, within ${kilometres} km, scaled to this home's size. Asking prices are not sale prices, and the fee, floor and condition are not considered. In a test on the other homes it held the real asking price about three times in four.`}
    >
      <Text size="sm" fw={600} tabIndex={0}>
        Estimate {compactPrice(estimate.lowSek)}–
        {compactPrice(estimate.highSek)}
        <Text span size="sm" c="dimmed" fw={400}>
          {' '}
          from {estimate.basedOn} nearby asking prices
        </Text>
      </Text>
    </Tooltip>
  );
}
