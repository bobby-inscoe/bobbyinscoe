import {
  Button,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { createContext, type ReactNode, useContext, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { usePriceEstimate } from '@/features/house-scanner/components/price-estimate';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type {
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import {
  formatFee,
  formatMonth,
  formatPrice,
} from '@/features/house-scanner/utils/format';
import {
  DEFAULT_FINANCING,
  financingProfile,
  housingCost,
  monthlyFee,
  startingCash,
  startingPrice,
  TYPICAL_RATE_MONTH,
} from '@/features/house-scanner/utils/housing-cost';

// A rate a member is trying out. It applies to every home until reset or reload, and is never saved.
const RateScenario = createContext<
  [number | null, (rate: number | null) => void]
>([null, () => {}]);

export function RateScenarioProvider({ children }: { children: ReactNode }) {
  const state = useState<number | null>(null);
  return (
    <RateScenario.Provider value={state}>{children}</RateScenario.Provider>
  );
}

/**
 * What the home would cost each month with the household's financing. Price and cash start from the listing and the
 * household and can be changed here; the caller remounts this per home, which discards those changes.
 */
export function MonthlyCost({
  listing,
  snapshot,
}: {
  listing: Listing;
  snapshot: Snapshot;
}) {
  const intl = useIntl();
  const estimate = usePriceEstimate(listing);
  const saved = financingProfile(snapshot.profiles)?.criteria.financing;
  const financing = saved ?? DEFAULT_FINANCING;
  const [price, setPrice] = useState(() => startingPrice(listing, estimate));
  // Null follows the price, so a new price moves the 10% minimum with it.
  const [cash, setCash] = useState<number | null>(null);
  const [scenario, setScenario] = useContext(RateScenario);
  const baseRate = financing.interestRatePercent;
  const rate = scenario ?? baseRate;
  const sv = intl.locale.startsWith('sv');
  const separators = {
    thousandSeparator: sv ? ' ' : ',',
    decimalSeparator: sv ? ',' : '.',
  };
  const { facts, conflicts } = listing;
  const ownership =
    facts.tenure === 'ownership' && !conflicts.includes('tenure');
  const house = facts.propertyType === 'house';
  const fee = monthlyFee(listing);
  const result =
    price && price > 0
      ? housingCost({
          priceSek: price,
          cashSek: cash ?? startingCash(price, financing),
          interestRatePercent: rate,
          taxDeduction: financing.taxDeduction,
          feeSek: fee,
          ownership,
        })
      : null;
  const percent = (value: number) =>
    intl.formatNumber(value, { maximumFractionDigits: 2 });
  const setRate = (value: number) =>
    setScenario(Math.abs(value - baseRate) < 0.001 ? null : value);

  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Title order={3} size="h4">
          <FormattedMessage id="listings.cost.heading" />
        </Title>
        {result?.kind === 'cost' && (
          <>
            <Text size="xl" fw={700}>
              {formatFee(result.cost.totalSek, intl)}
            </Text>
            <dl className={classes.factList}>
              {[
                {
                  label: intl.formatMessage({ id: 'listings.cost.interest' }),
                  value: result.cost.interestSek,
                },
                ...(financing.taxDeduction
                  ? [
                      {
                        label: intl.formatMessage({
                          id: 'listings.cost.taxDeduction',
                        }),
                        value: -result.cost.deductionSek,
                      },
                    ]
                  : []),
                {
                  label: intl.formatMessage(
                    { id: 'listings.cost.amortization' },
                    { percent: result.cost.amortizationPercent },
                  ),
                  value: result.cost.amortizationSek,
                },
                ...(result.cost.feeSek !== null
                  ? [
                      {
                        label: intl.formatMessage({ id: 'listings.cost.fee' }),
                        value: result.cost.feeSek,
                      },
                    ]
                  : []),
              ].map(({ label, value }) => (
                <div key={label} className={classes.factRow}>
                  <dt>{label}</dt>
                  <dd>{formatFee(value, intl)}</dd>
                </div>
              ))}
            </dl>
            <Text size="sm" c="dimmed">
              <FormattedMessage
                id="listings.cost.loan"
                values={{
                  loan: formatPrice(result.cost.loanSek, intl),
                  share: percent(
                    Math.round((result.cost.loanSek / (price ?? 1)) * 100),
                  ),
                }}
              />
            </Text>
            {result.cost.feeSek === null && !ownership && (
              <Text size="sm" c="orange.8">
                <FormattedMessage id="listings.cost.feeUnknown" />
              </Text>
            )}
            {house && (
              <Text size="sm" c="dimmed">
                <FormattedMessage id="listings.cost.runningCosts" />
              </Text>
            )}
            {result.cost.titleFeeSek !== null && (
              <Text size="sm" c="dimmed">
                <FormattedMessage
                  id="listings.cost.oneTime"
                  values={{
                    title: formatPrice(result.cost.titleFeeSek, intl),
                    deeds: formatPrice(result.cost.deedFeeSek ?? 0, intl),
                  }}
                />
              </Text>
            )}
          </>
        )}
        {result?.kind === 'short' && (
          <Text size="sm" c="orange.8" role="status">
            <FormattedMessage
              id="listings.cost.shortfall"
              values={{ amount: formatPrice(result.shortfallSek, intl) }}
            />
          </Text>
        )}
        {result === null && (
          <Text size="sm">
            <FormattedMessage id="listings.cost.noPrice" />
          </Text>
        )}
        <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="xs">
          <NumberInput
            size="xs"
            label={intl.formatMessage({ id: 'listings.cost.price' })}
            value={price ?? ''}
            min={0}
            allowDecimal={false}
            allowNegative={false}
            {...separators}
            onChange={(value) =>
              setPrice(typeof value === 'number' ? value : null)
            }
          />
          <NumberInput
            size="xs"
            label={intl.formatMessage({ id: 'listings.cost.cash' })}
            value={cash ?? (price ? startingCash(price, financing) : '')}
            min={0}
            allowDecimal={false}
            allowNegative={false}
            {...separators}
            onChange={(value) =>
              setCash(typeof value === 'number' ? value : null)
            }
          />
          <NumberInput
            size="xs"
            label={intl.formatMessage({ id: 'listings.cost.rate' })}
            value={rate}
            min={0.01}
            max={20}
            step={0.1}
            classNames={{ controls: classes.rateControls }}
            decimalScale={2}
            allowNegative={false}
            decimalSeparator={separators.decimalSeparator}
            onChange={(value) => typeof value === 'number' && setRate(value)}
          />
        </SimpleGrid>
        {scenario !== null && (
          <Group gap="xs">
            <Text size="sm" c="orange.8">
              <FormattedMessage id="listings.cost.scenario" />
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setScenario(null)}
            >
              <FormattedMessage id="listings.cost.reset" />
            </Button>
          </Group>
        )}
        {!saved && (
          <Text size="sm" c="dimmed">
            <FormattedMessage
              id="listings.cost.typical"
              values={{ month: formatMonth(TYPICAL_RATE_MONTH, intl) }}
            />
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
