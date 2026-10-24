import {
  Button,
  Group,
  NumberInput,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { SearchLocationFields } from '@/features/house-scanner/features/settings/features/criteria/components/search-location-fields';
import {
  errorFeedback,
  type Feedback,
  formatFeedback,
  validationFeedback,
} from '@/features/house-scanner/i18n/catalogs';
import {
  type Criteria,
  criteriaSchema,
  type SearchProfile,
  type Snapshot,
} from '@/features/house-scanner/types/contracts';

// A new household starts with one profile at revision 1, set to the collector bounds, and any save raises it. While it
// lasts, an owner gets the setup card on Listings and everyone else a note that an owner can change it.
export function StarterSetup({
  snapshot,
  userId,
  showCard,
  onSave,
}: {
  snapshot: Snapshot;
  userId: string;
  showCard: boolean;
  onSave?: (profile: SearchProfile) => Promise<void>;
}) {
  const [profile] = snapshot.profiles;
  if (snapshot.profiles.length !== 1 || profile.revision !== 1) return null;
  const owner = snapshot.members.some(
    (member) => member.userId === userId && member.role === 'owner',
  );
  if (owner && onSave)
    return showCard ? (
      <StarterSetupCard profile={profile} onSave={onSave} />
    ) : null;
  return (
    <Text size="sm" role="note">
      <FormattedMessage id="navigation.thisHouseholdUsesStarterCriteriaApartmentsInGoteborgFrom" />
    </Text>
  );
}

// Either button saves the whole profile, which raises its revision and retires the card for every member.
function StarterSetupCard({
  profile,
  onSave,
}: {
  profile: SearchProfile;
  onSave: (profile: SearchProfile) => Promise<void>;
}) {
  const intl = useIntl();
  const [criteria, setCriteria] = useState(profile.criteria);
  const [message, setMessage] = useState<Feedback>('');
  const [busy, setBusy] = useState(false);
  async function save(next: Criteria) {
    const result = criteriaSchema.safeParse(next);
    if (!result.success) {
      setMessage(validationFeedback(result.error.issues));
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await onSave({ ...profile, criteria: result.data });
    } catch (error) {
      setMessage(errorFeedback(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Paper>
      <Stack gap="sm">
        <Title order={2}>
          <FormattedMessage id="settings.criteria.setupTitle" />
        </Title>
        <Text size="sm">
          <FormattedMessage id="settings.criteria.setupIntro" />
        </Text>
        <SearchLocationFields
          geography={criteria.geography}
          disabled={busy}
          onChange={(geography) =>
            setCriteria((current) => ({ ...current, geography }))
          }
        />
        <NumberInput
          label={intl.formatMessage({
            id: 'settings.criteria.stretchBudgetSEK',
          })}
          description={intl.formatMessage({
            id: 'settings.criteria.maximumBudgetDescription',
          })}
          thousandSeparator={intl.locale.startsWith('sv') ? ' ' : ','}
          decimalSeparator={intl.locale.startsWith('sv') ? ',' : '.'}
          value={criteria.stretchPriceSek}
          min={0}
          allowDecimal={false}
          disabled={busy}
          onChange={(value) =>
            setCriteria((current) => ({
              ...current,
              stretchPriceSek: typeof value === 'number' ? value : 0,
            }))
          }
        />
        <Group gap="sm">
          <Button
            loading={busy}
            onClick={() =>
              void save({
                ...criteria,
                // The card has no preferred budget field, so a lower maximum pulls it down instead of failing.
                preferredPriceSek: Math.min(
                  criteria.preferredPriceSek,
                  criteria.stretchPriceSek,
                ),
              })
            }
          >
            <FormattedMessage id="common.save" />
          </Button>
          <Button
            variant="default"
            disabled={busy}
            onClick={() => void save(profile.criteria)}
          >
            <FormattedMessage id="settings.criteria.keepStarterCriteria" />
          </Button>
        </Group>
        {message && (
          <Text size="sm" role="alert">
            {formatFeedback(intl, message)}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
