import {
  Button,
  Checkbox,
  MultiSelect,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { type ReactNode, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { NumberSelect } from '@/features/house-scanner/components/number-select';
import { SearchLocationFields } from '@/features/house-scanner/features/settings/features/criteria/components/search-location-fields';
import {
  errorFeedback,
  type Feedback,
  formatFeedback,
  validationFeedback,
} from '@/features/house-scanner/i18n/catalogs';
import {
  criteriaSchema,
  type SearchProfile,
} from '@/features/house-scanner/types/contracts';
import {
  AREA_OPTIONS,
  formatArea,
  formatRooms,
  ROOM_OPTIONS,
  SOURCES,
} from '@/features/house-scanner/utils/criteria-options';

export function ProfileEditor({
  profile,
  canEdit,
  onSave,
  header,
}: {
  header?: ReactNode;
  profile: SearchProfile;
  canEdit: boolean;
  onSave?: (profile: SearchProfile) => Promise<void>;
}) {
  const intl = useIntl();

  const [criteria, setCriteria] = useState(profile.criteria);
  const [enabled, setEnabled] = useState(profile.enabled);
  const [message, setMessage] = useState<Feedback>('');
  const [busy, setBusy] = useState(false);
  // A new revision (ours or another member's) resets the fields but keeps the status message.
  const [seenRevision, setSeenRevision] = useState(profile.revision);
  if (seenRevision !== profile.revision) {
    setSeenRevision(profile.revision);
    setCriteria(profile.criteria);
    setEnabled(profile.enabled);
  }
  function numeric(
    key: 'preferredPriceSek' | 'stretchPriceSek' | 'feeReferenceSek',
    label: string,
    description: string,
  ) {
    return (
      <NumberInput
        key={key}
        label={label}
        description={description}
        thousandSeparator={intl.locale.startsWith('sv') ? ' ' : ','}
        value={criteria[key]}
        min={0}
        allowDecimal={false}
        disabled={!canEdit || !onSave}
        onChange={(value) =>
          setCriteria((current) => ({
            ...current,
            [key]: typeof value === 'number' ? value : 0,
          }))
        }
        decimalSeparator={intl.locale.startsWith('sv') ? ',' : '.'}
      />
    );
  }
  function toggle(
    key:
      | 'excludeGroundFloor'
      | 'requireLift'
      | 'requireOutdoor'
      | 'hideUnknownPrice',
    label: string,
  ) {
    return (
      <Checkbox
        key={key}
        label={label}
        checked={criteria[key] ?? false}
        disabled={!canEdit || !onSave}
        onChange={(event) => {
          const checked = event.currentTarget.checked;
          setCriteria((current) => ({ ...current, [key]: checked }));
        }}
      />
    );
  }
  async function save() {
    const result = criteriaSchema.safeParse(criteria);
    if (!result.success) {
      setMessage(validationFeedback(result.error.issues));
      return;
    }
    if (!canEdit || !onSave) return;
    setBusy(true);
    try {
      // House Scanner covers apartments only; an older profile that also chose houses is narrowed on save.
      await onSave({
        ...profile,
        enabled,
        criteria: { ...result.data, propertyTypes: ['apartment'] },
      });
      setMessage(
        'settings.criteria.profileSavedStoredHomesAreReEvaluatedAgainstThe',
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
        {header}
        <Checkbox
          label={intl.formatMessage({
            id: 'settings.criteria.enabledSearchProfile',
          })}
          checked={enabled}
          disabled={!canEdit || !onSave}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {numeric(
            'preferredPriceSek',
            intl.formatMessage({ id: 'settings.criteria.preferredBudgetSEK' }),
            intl.formatMessage({
              id: 'settings.criteria.preferredBudgetDescription',
            }),
          )}
          {numeric(
            'stretchPriceSek',
            intl.formatMessage({ id: 'settings.criteria.stretchBudgetSEK' }),
            intl.formatMessage({
              id: 'settings.criteria.maximumBudgetDescription',
            }),
          )}
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <NumberSelect
            label={intl.formatMessage({
              id: 'settings.criteria.minimumLivingArea',
            })}
            ariaLabel={intl.formatMessage({
              id: 'settings.criteria.minimumLivingAreaM',
            })}
            value={criteria.minAreaM2}
            onChange={(value) =>
              value !== null &&
              setCriteria((current) => ({ ...current, minAreaM2: value }))
            }
            options={AREA_OPTIONS}
            format={(value) => formatArea(value, intl)}
            disabled={!canEdit || !onSave}
          />
          <NumberSelect
            label={intl.formatMessage({
              id: 'settings.criteria.maximumLivingArea',
            })}
            ariaLabel={intl.formatMessage({
              id: 'settings.criteria.maximumLivingAreaM',
            })}
            value={criteria.maxAreaM2}
            onChange={(value) =>
              setCriteria((current) => ({ ...current, maxAreaM2: value }))
            }
            options={AREA_OPTIONS}
            format={(value) => formatArea(value, intl)}
            anyLabel={intl.formatMessage({ id: 'settings.criteria.noMaximum' })}
            disabled={!canEdit || !onSave}
          />
          <NumberSelect
            label={intl.formatMessage({ id: 'settings.criteria.minimumRooms' })}
            value={criteria.minRooms}
            onChange={(value) =>
              value !== null &&
              setCriteria((current) => ({ ...current, minRooms: value }))
            }
            options={ROOM_OPTIONS}
            format={(value) => formatRooms(value, intl)}
            disabled={!canEdit || !onSave}
          />
        </SimpleGrid>
        <Text size="sm">
          <FormattedMessage id="settings.criteria.apartmentRules" />
        </Text>
        <Text size="sm" c="dimmed">
          <FormattedMessage id="settings.criteria.apartmentRulesDescription" />
        </Text>
        {toggle(
          'excludeGroundFloor',
          intl.formatMessage({
            id: 'settings.criteria.excludeConfirmedGroundFloorApartments',
          }),
        )}
        {toggle(
          'requireLift',
          intl.formatMessage({ id: 'settings.criteria.requireALift' }),
        )}
        {toggle(
          'requireOutdoor',
          intl.formatMessage({
            id: 'settings.criteria.requireABalconyOrTerrace',
          }),
        )}
        {toggle(
          'hideUnknownPrice',
          intl.formatMessage({ id: 'settings.criteria.hideUnknownPrice' }),
        )}
        {numeric(
          'feeReferenceSek',
          intl.formatMessage({ id: 'settings.criteria.monthlyFeeLabel' }),
          intl.formatMessage({ id: 'settings.criteria.monthlyFeeDescription' }),
        )}
        <SearchLocationFields
          geography={criteria.geography}
          disabled={!canEdit || !onSave}
          onChange={(geography) =>
            setCriteria((current) => ({ ...current, geography }))
          }
        />
        <MultiSelect
          label={intl.formatMessage({ id: 'settings.criteria.sources' })}
          description={intl.formatMessage({
            id: 'settings.criteria.showHomesFromTheseBrokersOnlyLeaveEmptyFor',
          })}
          placeholder={
            criteria.sourceIds
              ? undefined
              : intl.formatMessage({ id: 'settings.criteria.everySource' })
          }
          value={criteria.sourceIds ?? []}
          onChange={(sourceIds) =>
            setCriteria((current) => ({
              ...current,
              sourceIds: sourceIds.length ? sourceIds : undefined,
            }))
          }
          data={[
            ...SOURCES,
            ...(criteria.sourceIds ?? [])
              .filter((id) => !SOURCES.some(({ value }) => value === id))
              .map((value) => ({
                value,
                label: intl.formatMessage(
                  { id: 'settings.criteria.notCollected' },
                  { value0: value },
                ),
                disabled: true,
              })),
          ]}
          disabled={!canEdit || !onSave}
        />
        <Button disabled={!canEdit || !onSave} loading={busy} onClick={save}>
          <FormattedMessage id="settings.criteria.saveCriteria" />
        </Button>
        {!canEdit && (
          <Text size="sm">
            <FormattedMessage id="settings.criteria.onlyHouseholdOwnersCanChangeSharedCriteria" />
          </Text>
        )}
        {canEdit && !onSave && (
          <Text size="sm">
            <FormattedMessage id="settings.criteria.profileChangesAreUnavailableInThisView" />
          </Text>
        )}
        <Text role="status">{formatFeedback(intl, message)}</Text>
      </Stack>
    </Paper>
  );
}
