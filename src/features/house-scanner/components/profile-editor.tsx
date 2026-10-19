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
  Title,
} from '@mantine/core';
import { useState } from 'react';

import { NumberSelect } from '@/features/house-scanner/components/number-select';
import {
  type Criteria,
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
} from '@/features/house-scanner/utils/criteria-options';
import { formatDate } from '@/features/house-scanner/utils/format';

// Supported places can be picked; the rest show why they cannot. A saved name that is in neither
// stays visible, so opening the editor never drops it silently.
function places(saved: string[]) {
  const known = new Set(MUNICIPALITIES.map(({ value }) => value));
  return [
    ...MUNICIPALITIES.map(({ value, supported }) => ({
      value,
      label: supported ? value : `${value} (coming soon)`,
      disabled: !supported,
    })),
    ...saved
      .filter((value) => !known.has(value))
      .map((value) => ({
        value,
        label: `${value} (not supported)`,
        disabled: true,
      })),
  ];
}

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
  function numeric(
    key: 'preferredPriceSek' | 'stretchPriceSek' | 'feeReferenceSek',
    label: string,
  ) {
    return (
      <NumberInput
        key={key}
        label={label}
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
      setMessage(result.error.issues.map((issue) => issue.message).join(' '));
      return;
    }
    if (!canEdit || !onSave) return;
    setBusy(true);
    try {
      await onSave({ ...profile, enabled, criteria: result.data });
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
  function setType(type: Criteria['propertyTypes'][number], checked: boolean) {
    setCriteria((current) => ({
      ...current,
      propertyTypes: checked
        ? [...new Set([...current.propertyTypes, type])]
        : current.propertyTypes.filter((value) => value !== type),
    }));
  }
  return (
    <Paper withBorder p="md">
      <Stack>
        <Title order={3}>{profile.name}</Title>
        <Text size="sm">
          Revision {profile.revision} · edited {formatDate(profile.editedAt)}
        </Text>
        <Checkbox
          label="Enabled search profile"
          checked={enabled}
          disabled={!canEdit || !onSave}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {numeric('preferredPriceSek', 'Preferred budget (SEK)')}
          {numeric('stretchPriceSek', 'Stretch budget (SEK)')}
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
        <Group>
          <Checkbox
            label="Apartments"
            checked={criteria.propertyTypes.includes('apartment')}
            disabled={!canEdit || !onSave}
            onChange={(event) =>
              setType('apartment', event.currentTarget.checked)
            }
          />
          <Checkbox
            label="Houses"
            checked={criteria.propertyTypes.includes('house')}
            disabled={!canEdit || !onSave}
            onChange={(event) => setType('house', event.currentTarget.checked)}
          />
        </Group>
        <Text size="sm">Apartment rules</Text>
        {toggle(
          'excludeGroundFloor',
          'Exclude confirmed ground-floor apartments',
        )}
        {toggle('requireLift', 'Require a lift')}
        {toggle('requireOutdoor', 'Require a balcony or terrace')}
        {toggle(
          'preferGlazing',
          'Prefer glazed outdoor space (exceptions stay visible)',
        )}
        {numeric('feeReferenceSek', 'Monthly fee reference (SEK, a cost flag)')}
        <MultiSelect
          label="Places to search"
          description="The areas the collector reads, and the areas a home can be in to count as inside your search."
          value={criteria.geography.municipalities}
          onChange={(municipalities) =>
            setCriteria((current) => ({
              ...current,
              geography: { ...current.geography, municipalities },
            }))
          }
          data={places(criteria.geography.municipalities)}
          comboboxProps={{ withinPortal: false }}
          disabled={!canEdit || !onSave}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="Centre of the search circle"
            description="A home within the radius of this point also counts as inside your search."
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
                label: 'Brunnsparken, central Göteborg',
              },
              ...(isNear(criteria.geography.center, BRUNNSPARKEN)
                ? []
                : [
                    {
                      value: 'current',
                      label: `Current point (${criteria.geography.center[1].toFixed(3)}, ${criteria.geography.center[0].toFixed(3)})`,
                    },
                  ]),
            ]}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
            disabled={!canEdit || !onSave}
          />
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
        </SimpleGrid>
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
