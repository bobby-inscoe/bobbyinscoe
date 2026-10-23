import { Text, Tooltip } from '@mantine/core';
import { FormattedMessage, useIntl } from 'react-intl';
import { messageValue } from '@/features/house-scanner/i18n/catalogs';

import type { Listing } from '@/features/house-scanner/types/contracts';
import { compactPrice } from '@/features/house-scanner/utils/format';

/** True when the home has no asking price and the database's range stands in for it. */
export function useHasEstimate(listing: Listing) {
  return listing.priceEstimate !== undefined;
}

/** The database's estimate for a home with no asking price, if it has one. */
export function usePriceEstimate(listing: Listing) {
  return listing.priceEstimate;
}

/** "Estimate 2.8M–3.8M · expected sale price 3.4M": the database's guide for a home with no asking price. */
export function EstimateLine({ listing }: { listing: Listing }) {
  const intl = useIntl();
  const estimate = listing.priceEstimate;
  if (!estimate) return null;
  const kilometres = intl.formatNumber((estimate.farthestM ?? 0) / 1000, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return (
    <Tooltip
      multiline
      w={300}
      events={{ hover: true, focus: true, touch: true }}
      label={
        estimate.nearby > 0
          ? intl.formatMessage(
              { id: 'listings.details.estimateBasis' },
              { value0: messageValue(kilometres) },
            )
          : intl.formatMessage({ id: 'listings.details.estimateBasisArea' })
      }
    >
      <Text size="sm" fw={600} tabIndex={0}>
        <FormattedMessage id="listings.details.estimate" />{' '}
        {compactPrice(estimate.lowSek, intl)}–
        {compactPrice(estimate.highSek, intl)}
        <Text span size="sm" c="dimmed" fw={400}>
          {' '}
          <FormattedMessage
            id="listings.details.expectedSalePrice"
            values={{ value0: compactPrice(estimate.finalSek, intl) }}
          />
        </Text>
      </Text>
    </Tooltip>
  );
}
