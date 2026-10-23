import {
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  errorFeedback,
  type Feedback,
  formatFeedback,
} from '@/features/house-scanner/i18n/catalogs';
import type {
  Financing,
  SearchProfile,
} from '@/features/house-scanner/types/contracts';
import { formatMonth } from '@/features/house-scanner/utils/format';
import {
  DEFAULT_FINANCING,
  TYPICAL_RATE_MONTH,
  TYPICAL_RATE_PERCENT,
} from '@/features/house-scanner/utils/housing-cost';

// The household's financing lives on its profile. Saving writes only this key onto the saved criteria, so unsaved
// edits in the criteria form are not sent with it.
export function FinancingEditor({
  profile,
  canEdit,
  onSave,
}: {
  profile: SearchProfile;
  canEdit: boolean;
  onSave?: (profile: SearchProfile) => Promise<void>;
}) {
  const intl = useIntl();
  const saved = profile.criteria.financing;
  const [financing, setFinancing] = useState<Financing>(
    saved ?? DEFAULT_FINANCING,
  );
  const [message, setMessage] = useState<Feedback>('');
  const [busy, setBusy] = useState(false);
  const [seenRevision, setSeenRevision] = useState(profile.revision);
  if (seenRevision !== profile.revision) {
    setSeenRevision(profile.revision);
    setFinancing(saved ?? DEFAULT_FINANCING);
  }
  const disabled = !canEdit || !onSave;
  const sv = intl.locale.startsWith('sv');
  async function save(next: Financing | undefined) {
    if (disabled) return;
    setBusy(true);
    try {
      const { financing: _, ...criteria } = profile.criteria;
      await onSave({
        ...profile,
        criteria: next ? { ...criteria, financing: next } : criteria,
      });
      setMessage(
        next ? 'settings.financing.saved' : 'settings.financing.usingTypical',
      );
    } catch (error) {
      setMessage(errorFeedback(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Paper>
      <Stack>
        <Title order={2}>
          <FormattedMessage id="settings.financing.heading" />
        </Title>
        <Text size="sm" c="dimmed">
          <FormattedMessage id="settings.financing.description" />
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <NumberInput
            label={intl.formatMessage({ id: 'settings.financing.cash' })}
            description={intl.formatMessage({
              id: 'settings.financing.cashDescription',
            })}
            thousandSeparator={sv ? ' ' : ','}
            value={financing.cashSek ?? ''}
            min={0}
            allowDecimal={false}
            allowNegative={false}
            disabled={disabled}
            onChange={(value) =>
              setFinancing((current) => ({
                ...current,
                cashSek: typeof value === 'number' ? value : null,
              }))
            }
          />
          <NumberInput
            label={intl.formatMessage({ id: 'settings.financing.rate' })}
            description={intl.formatMessage(
              { id: 'settings.financing.rateDescription' },
              {
                rate: intl.formatNumber(TYPICAL_RATE_PERCENT, {
                  minimumFractionDigits: 2,
                }),
                month: formatMonth(TYPICAL_RATE_MONTH, intl),
              },
            )}
            value={financing.interestRatePercent}
            min={0.01}
            max={20}
            step={0.05}
            decimalScale={2}
            decimalSeparator={sv ? ',' : '.'}
            allowNegative={false}
            disabled={disabled}
            onChange={(value) =>
              setFinancing((current) => ({
                ...current,
                interestRatePercent: typeof value === 'number' ? value : 0,
              }))
            }
          />
        </SimpleGrid>
        <Checkbox
          label={intl.formatMessage({ id: 'settings.financing.taxDeduction' })}
          checked={financing.taxDeduction}
          disabled={disabled}
          onChange={(event) => {
            const checked = event.currentTarget.checked;
            setFinancing((current) => ({ ...current, taxDeduction: checked }));
          }}
        />
        <Group>
          <Button
            disabled={
              disabled ||
              !(
                financing.interestRatePercent > 0 &&
                financing.interestRatePercent <= 20
              )
            }
            loading={busy}
            onClick={() => save(financing)}
          >
            <FormattedMessage id="settings.financing.save" />
          </Button>
          {saved && (
            <Button
              variant="default"
              disabled={disabled}
              loading={busy}
              onClick={() => save(undefined)}
            >
              <FormattedMessage id="settings.financing.useTypical" />
            </Button>
          )}
        </Group>
        {!saved && !message && (
          <Text size="sm">
            <FormattedMessage id="settings.financing.usingTypical" />
          </Text>
        )}
        {!canEdit && (
          <Text size="sm">
            <FormattedMessage id="settings.financing.ownerOnly" />
          </Text>
        )}
        <Text role="status">{formatFeedback(intl, message)}</Text>
      </Stack>
    </Paper>
  );
}
