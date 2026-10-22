import {
  Button,
  Checkbox,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from '@mantine/core';
import { Info } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { FormattedMessage, type IntlShape, useIntl } from 'react-intl';
import { NumberSelect } from '@/features/house-scanner/components/number-select';
import {
  englishIntl,
  errorFeedback,
  type Feedback,
  formatFeedback,
  messageValue,
  validationFeedback,
} from '@/features/house-scanner/i18n/catalogs';
import {
  criteriaSchema,
  type SearchProfile,
} from '@/features/house-scanner/types/contracts';
import {
  AREA_OPTIONS,
  BRUNNSPARKEN,
  formatArea,
  formatKm,
  formatRooms,
  isNear,
  MUNICIPALITIES,
  RADIUS_OPTIONS_KM,
  ROOM_OPTIONS,
  SOURCES,
} from '@/features/house-scanner/utils/criteria-options';

// Supported places can be picked; the rest show why they cannot. A saved name that is in neither
// stays visible, so opening the editor never drops it silently.
function places(saved: string[], intl: IntlShape = englishIntl) {
  const known = new Set(MUNICIPALITIES.map(({ value }) => value));
  return [
    ...MUNICIPALITIES.map(({ value, supported }) => ({
      value,
      label: supported
        ? value
        : intl.formatMessage(
            { id: 'settings.criteria.comingSoon' },
            { value0: messageValue(value) },
          ),
      disabled: !supported,
    })),
    ...saved
      .filter((value) => !known.has(value))
      .map((value) => ({
        value,
        label: intl.formatMessage(
          { id: 'settings.criteria.notSupported' },
          { value0: messageValue(value) },
        ),
        disabled: true,
      })),
  ];
}

// A field label with the field's explanation in a hover tooltip.
function LabelWithInfo({
  info,
  children,
}: {
  info: string;
  children: import('react').ReactNode;
}) {
  return (
    <Group gap={4} wrap="nowrap">
      {children}
      <Tooltip multiline w={240} label={info}>
        <Info size={14} aria-hidden />
      </Tooltip>
    </Group>
  );
}

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
  ) {
    return (
      <NumberInput
        key={key}
        label={label}
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
      | 'preferGlazing',
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
          )}
          {numeric(
            'stretchPriceSek',
            intl.formatMessage({ id: 'settings.criteria.stretchBudgetSEK' }),
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
          'preferGlazing',
          intl.formatMessage({
            id: 'settings.criteria.preferGlazedOutdoorSpaceExceptionsStayVisible',
          }),
        )}
        {numeric(
          'feeReferenceSek',
          intl.formatMessage({
            id: 'settings.criteria.monthlyFeeReferenceSEKACostFlag',
          }),
        )}
        <MultiSelect
          label={
            <LabelWithInfo
              info={intl.formatMessage({
                id: 'settings.criteria.theAreasTheCollectorReadsAndTheAreasA',
              })}
            >
              <FormattedMessage id="settings.criteria.placesToSearch" />
            </LabelWithInfo>
          }
          styles={{ input: { display: 'grid', alignItems: 'center' } }}
          value={criteria.geography.municipalities}
          onChange={(municipalities) =>
            setCriteria((current) => ({
              ...current,
              geography: { ...current.geography, municipalities },
            }))
          }
          data={places(criteria.geography.municipalities, intl)}
          disabled={!canEdit || !onSave}
        />
        <MultiSelect
          label={
            <LabelWithInfo
              info={intl.formatMessage({
                id: 'settings.criteria.showHomesFromTheseBrokersOnlyLeaveEmptyFor',
              })}
            >
              <FormattedMessage id="settings.criteria.sources" />
            </LabelWithInfo>
          }
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
            // A saved source the collector no longer reads stays visible, as places do.
            ...(criteria.sourceIds ?? [])
              .filter((id) => !SOURCES.some(({ value }) => value === id))
              .map((value) => ({
                value,
                label: intl.formatMessage(
                  { id: 'settings.criteria.notCollected' },
                  { value0: messageValue(value) },
                ),
                disabled: true,
              })),
          ]}
          disabled={!canEdit || !onSave}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label={
              <LabelWithInfo
                info={intl.formatMessage({
                  id: 'settings.criteria.homesWithinTheRadiusOfThisPointCountAs',
                })}
              >
                <FormattedMessage id="settings.criteria.searchFrom" />
              </LabelWithInfo>
            }
            value={
              isNear(criteria.geography.center, BRUNNSPARKEN)
                ? 'brunnsparken'
                : 'current'
            }
            onChange={(next) => {
              if (next === 'brunnsparken')
                setCriteria((current) => ({
                  ...current,
                  geography: {
                    ...current.geography,
                    center: [...BRUNNSPARKEN],
                  },
                }));
            }}
            data={[
              {
                value: 'brunnsparken',
                label: intl.formatMessage({
                  id: 'settings.criteria.brunnsparkenCentralGoteborg',
                }),
              },
              ...(isNear(criteria.geography.center, BRUNNSPARKEN)
                ? []
                : [
                    {
                      value: 'current',
                      label: intl.formatMessage(
                        { id: 'settings.criteria.currentPoint' },
                        {
                          value0: messageValue(
                            criteria.geography.center[1].toFixed(3),
                          ),
                          value1: messageValue(
                            criteria.geography.center[0].toFixed(3),
                          ),
                        },
                      ),
                    },
                  ]),
            ]}
            allowDeselect={false}
            disabled={!canEdit || !onSave}
          />
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
        </SimpleGrid>
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
