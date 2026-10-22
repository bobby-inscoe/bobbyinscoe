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
import { useState } from 'react';

import { NumberSelect } from '@/features/house-scanner/components/number-select';
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
}: {
  profile: SearchProfile;
  canEdit: boolean;
  onSave?: (profile: SearchProfile) => Promise<void>;
}) {
  const [criteria, setCriteria] = useState(profile.criteria);
  const [enabled, setEnabled] = useState(profile.enabled);
  const [message, setMessage] = useState('');
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
        thousandSeparator=" "
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
      setMessage(result.error.issues.map((issue) => issue.message).join(' '));
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
        'Profile saved. Stored homes are re-evaluated against the saved criteria. Collection coverage is unchanged.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not save criteria. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Paper>
      <Stack>
        <Checkbox
          label="Enabled search profile"
          checked={enabled}
          disabled={!canEdit || !onSave}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {numeric(
            'preferredPriceSek',
            'Preferred budget (SEK)',
            'Homes at or below this price are grouped as Within budget.',
          )}
          {numeric(
            'stretchPriceSek',
            'Maximum budget (SEK)',
            'Homes with a known asking price above this amount are excluded.',
          )}
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <NumberSelect
            label="Minimum living area"
            ariaLabel="Minimum living area (m²)"
            value={criteria.minAreaM2}
            onChange={(value) =>
              value !== null &&
              setCriteria((current) => ({ ...current, minAreaM2: value }))
            }
            options={AREA_OPTIONS}
            format={formatArea}
            disabled={!canEdit || !onSave}
          />
          <NumberSelect
            label="Maximum living area"
            ariaLabel="Maximum living area (m²)"
            value={criteria.maxAreaM2}
            onChange={(value) =>
              setCriteria((current) => ({ ...current, maxAreaM2: value }))
            }
            options={AREA_OPTIONS}
            format={formatArea}
            anyLabel="No maximum"
            disabled={!canEdit || !onSave}
          />
          <NumberSelect
            label="Minimum rooms"
            value={criteria.minRooms}
            onChange={(value) =>
              value !== null &&
              setCriteria((current) => ({ ...current, minRooms: value }))
            }
            options={ROOM_OPTIONS}
            format={formatRooms}
            disabled={!canEdit || !onSave}
          />
        </SimpleGrid>
        <Text size="sm">Apartment rules</Text>
        <Text size="sm" c="dimmed">
          Known mismatches are excluded. Unknown or disputed facts stay under
          Missing info.
        </Text>
        {toggle('excludeGroundFloor', 'Exclude ground floor apartments')}
        {toggle('requireLift', 'Require a lift')}
        {toggle('requireOutdoor', 'Require a balcony or terrace')}
        {numeric(
          'feeReferenceSek',
          'Monthly fee reference (SEK)',
          'Adds a cost warning above this amount. It does not exclude homes.',
        )}
        <Select
          label="Search location"
          description="Choose a whole city or a hub within it. Hubs use the radius below; whole cities use the municipality boundary. Coverage is currently limited to Göteborg."
          value={location}
          data={[
            ...(location === 'current'
              ? [
                  {
                    value: 'current',
                    label:
                      criteria.geography.mode === 'radius'
                        ? `Saved point (${criteria.geography.center[1].toFixed(3)}, ${criteria.geography.center[0].toFixed(3)})`
                        : 'Current saved search',
                    disabled: true,
                  },
                ]
              : []),
            ...MUNICIPALITIES.map(({ value, supported }) => ({
              group: value,
              items: [
                {
                  value: `city:${value}`,
                  label:
                    value + (supported ? ' (whole city)' : ' (coming soon)'),
                  disabled: !supported,
                },
                ...SEARCH_HUBS.filter(
                  (entry) => entry.municipality === value && supported,
                ).map(({ value, label }) => ({ value: `hub:${value}`, label })),
              ],
            })),
          ]}
          allowDeselect={false}
          searchable
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
            Your saved search includes{' '}
            {criteria.geography.municipalities.join(', ')} or homes within{' '}
            {formatKm(criteria.geography.radiusKm)} of its saved point. It stays
            unchanged until you choose a location.
          </Text>
        )}
        {criteria.geography.mode === 'radius' && (
          <NumberSelect
            label="Radius"
            value={criteria.geography.radiusKm}
            onChange={(radiusKm) =>
              radiusKm !== null &&
              setCriteria((current) => ({
                ...current,
                geography: { ...current.geography, radiusKm },
              }))
            }
            options={RADIUS_OPTIONS_KM}
            format={formatKm}
            disabled={!canEdit || !onSave}
          />
        )}
        <MultiSelect
          label="Sources"
          description="Show homes from these brokers only. Leave empty for every source."
          placeholder={criteria.sourceIds ? undefined : 'Every source'}
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
                label: `${value} (not collected)`,
                disabled: true,
              })),
          ]}
          disabled={!canEdit || !onSave}
        />
        <Button disabled={!canEdit || !onSave} loading={busy} onClick={save}>
          Save criteria
        </Button>
        {!canEdit && (
          <Text size="sm">
            Only household owners can change shared criteria.
          </Text>
        )}
        {canEdit && !onSave && (
          <Text size="sm">Profile changes are unavailable in this view.</Text>
        )}
        <Text role="status">{message}</Text>
      </Stack>
    </Paper>
  );
}
