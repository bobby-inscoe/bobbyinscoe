import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import { ChevronDown, ChevronUp } from 'lucide-react';
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
 * household. Price, cash, operating costs and tax relief edits are discarded when the caller remounts this per home.
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
  const sliderMax = Math.max(
    1000000,
    (startingPrice(listing, estimate) ?? 5000000) * 2,
  );
  const [price, setPrice] = useState(() => startingPrice(listing, estimate));
  const [operatingCosts, setOperatingCosts] = useState<number | string>(1000);
  const [taxDeduction, setTaxDeduction] = useState(financing.taxDeduction);
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
  const fee = monthlyFee(listing);
  const result =
    price && price > 0
      ? housingCost({
          priceSek: price,
          cashSek: cash ?? startingCash(price, financing),
          interestRatePercent: rate,
          taxDeduction,
          operatingCostsSek:
            typeof operatingCosts === 'number' ? operatingCosts : 0,
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
        <Group justify="space-between" gap="xs">
          {result?.kind === 'cost' && (
            <Text size="xl" fw={700}>
              {formatFee(result.cost.totalSek, intl)}
            </Text>
          )}
          <Switch
            label={intl.formatMessage({ id: 'listings.cost.taxDeduction' })}
            aria-label={intl.formatMessage({
              id: 'listings.cost.includeTaxDeduction',
            })}
            checked={taxDeduction}
            onChange={(event) => setTaxDeduction(event.currentTarget.checked)}
          />
        </Group>
        {result?.kind === 'cost' && (
          <>
            <dl className={classes.factList}>
              {[
                {
                  label: intl.formatMessage({ id: 'listings.cost.interest' }),
                  value: result.cost.interestSek,
                },
                {
                  label: intl.formatMessage({
                    id: 'listings.cost.taxDeduction',
                  }),
                  value: 0 - result.cost.deductionSek,
                },
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
                {
                  label: intl.formatMessage({
                    id: 'listings.cost.operatingCosts',
                  }),
                  value: result.cost.operatingCostsSek,
                },
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
          <Stack gap="xs">
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
            <Slider
              thumbSize={24}
              min={0}
              max={Math.max(sliderMax, price ?? 0)}
              step={50000}
              value={price ?? 0}
              onChange={setPrice}
              label={(value) => formatPrice(value, intl)}
              thumbLabel={intl.formatMessage({ id: 'listings.cost.price' })}
            />
          </Stack>
          <Stack gap="xs">
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
            <Slider
              thumbSize={24}
              min={0}
              max={Math.max(price ?? sliderMax, cash ?? 0, 1)}
              step={10000}
              value={cash ?? (price ? startingCash(price, financing) : 0)}
              onChange={setCash}
              label={(value) => formatPrice(value, intl)}
              thumbLabel={intl.formatMessage({ id: 'listings.cost.cash' })}
            />
          </Stack>
          <Stack gap="xs">
            <NumberInput
              size="xs"
              label={intl.formatMessage({ id: 'listings.cost.rate' })}
              value={rate}
              min={0.01}
              max={20}
              step={0.1}
              hideControls
              decimalScale={2}
              allowNegative={false}
              decimalSeparator={separators.decimalSeparator}
              onChange={(value) => typeof value === 'number' && setRate(value)}
            />
            <Group gap="xs">
              <ActionIcon
                variant="default"
                size="sm"
                disabled={rate <= 0.01}
                aria-label={`${intl.formatMessage({ id: 'listings.cost.rate' })} −0.1`}
                onClick={() =>
                  setRate(Math.max(0.01, Math.round((rate - 0.1) * 100) / 100))
                }
              >
                <ChevronDown size={16} aria-hidden />
              </ActionIcon>
              <ActionIcon
                variant="default"
                size="sm"
                disabled={rate >= 20}
                aria-label={`${intl.formatMessage({ id: 'listings.cost.rate' })} +0.1`}
                onClick={() =>
                  setRate(Math.min(20, Math.round((rate + 0.1) * 100) / 100))
                }
              >
                <ChevronUp size={16} aria-hidden />
              </ActionIcon>
            </Group>
          </Stack>
        </SimpleGrid>
        <NumberInput
          size="xs"
          label={intl.formatMessage({
            id: 'listings.cost.operatingCostsInput',
          })}
          description={intl.formatMessage({
            id: 'listings.cost.operatingCostsHelp',
          })}
          value={operatingCosts}
          min={0}
          allowDecimal={false}
          allowNegative={false}
          {...separators}
          onChange={setOperatingCosts}
        />
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
