import {
  Button,
  Checkbox,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { type ReactNode, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { NumberSelect } from '@/features/house-scanner/components/number-select';
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
  formatKm,
  formatRooms,
  isNear,
  MUNICIPALITIES,
  RADIUS_OPTIONS_KM,
  ROOM_OPTIONS,
  SEARCH_HUBS,
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
  const hub = SEARCH_HUBS.find(({ center }) =>
    isNear(criteria.geography.center, center),
  );
  const location =
    criteria.geography.mode === 'municipalities' &&
    criteria.geography.municipalities.length === 1 &&
    MUNICIPALITIES.some(
      ({ value }) => value === criteria.geography.municipalities[0],
    )
      ? `city:${criteria.geography.municipalities[0]}`
      : criteria.geography.mode === 'radius' && hub
        ? `hub:${hub.value}`
        : 'current';
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
    key: 'excludeGroundFloor' | 'requireLift' | 'requireOutdoor',
    label: string,
  ) {
    return (
      <Checkbox
        key={key}
        label={label}
        checked={criteria[key]}
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
        {numeric(
          'feeReferenceSek',
          intl.formatMessage({ id: 'settings.criteria.monthlyFeeLabel' }),
          intl.formatMessage({ id: 'settings.criteria.monthlyFeeDescription' }),
        )}
        <Select
          label={intl.formatMessage({ id: 'settings.criteria.searchLocation' })}
          description={intl.formatMessage({
            id: 'settings.criteria.searchLocationDescription',
          })}
          value={location}
          data={[
            ...(location === 'current'
              ? [
                  {
                    value: 'current',
                    label:
                      criteria.geography.mode === 'radius'
                        ? intl.formatMessage(
                            { id: 'settings.criteria.savedPoint' },
                            {
                              latitude: criteria.geography.center[1].toFixed(3),
                              longitude:
                                criteria.geography.center[0].toFixed(3),
                            },
                          )
                        : intl.formatMessage({
                            id: 'settings.criteria.currentSavedSearch',
                          }),
                    disabled: true,
                  },
                ]
              : []),
            ...MUNICIPALITIES.map(({ value, supported }) => ({
              group: value,
              items: [
                {
                  value: `city:${value}`,
                  label: supported
                    ? intl.formatMessage(
                        { id: 'settings.criteria.wholeCity' },
                        { city: value },
                      )
                    : intl.formatMessage(
                        { id: 'settings.criteria.comingSoon' },
                        { value0: value },
                      ),
                  disabled: !supported,
                },
                ...SEARCH_HUBS.filter(
                  (entry) => entry.municipality === value && supported,
                ).map(({ value, label }) => ({
                  value: `hub:${value}`,
                  label:
                    value === 'brunnsparken'
                      ? intl.formatMessage({
                          id: 'settings.criteria.brunnsparkenCentralGoteborg',
                        })
                      : label,
                })),
              ],
            })),
          ]}
          allowDeselect={false}
          disabled={!canEdit || !onSave}
          onChange={(next) => {
            const selected = SEARCH_HUBS.find(
              ({ value }) => `hub:${value}` === next,
            );
            const city = MUNICIPALITIES.find(
              ({ value, supported }) => supported && `city:${value}` === next,
            );
            if (selected)
              setCriteria((current) => ({
                ...current,
                geography: {
                  ...current.geography,
                  mode: 'radius',
                  center: [...selected.center],
                  municipalities: [selected.municipality],
                },
              }));
            else if (city)
              setCriteria((current) => ({
                ...current,
                geography: {
                  ...current.geography,
                  mode: 'municipalities',
                  municipalities: [city.value],
                },
              }));
          }}
        />
        {!criteria.geography.mode && (
          <Text size="sm" c="dimmed">
            <FormattedMessage
              id="settings.criteria.legacySearchDescription"
              values={{
                cities: criteria.geography.municipalities.join(', '),
                radius: formatKm(criteria.geography.radiusKm, intl),
              }}
            />
          </Text>
        )}
        {criteria.geography.mode === 'radius' && (
          <NumberSelect
            label={intl.formatMessage({ id: 'settings.criteria.radius' })}
            value={criteria.geography.radiusKm}
            onChange={(radiusKm) =>
              radiusKm !== null &&
              setCriteria((current) => ({
                ...current,
                geography: { ...current.geography, radiusKm },
              }))
            }
            options={RADIUS_OPTIONS_KM}
            format={(value) => formatKm(value, intl)}
            disabled={!canEdit || !onSave}
          />
        )}
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
