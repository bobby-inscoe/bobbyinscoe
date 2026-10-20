import {
  Button,
  Checkbox,
  Collapse,
  Flex,
  MultiSelect,
  NumberInput,
  Radio,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';

import neighborhoods from '@/features/house-scanner/assets/neighborhoods.json';
import { NumberSelect } from '@/features/house-scanner/components/number-select';
import {
  AREA_OPTIONS,
  formatArea,
  formatRooms,
  ROOM_OPTIONS,
} from '@/features/house-scanner/utils/criteria-options';
import {
  emptyFilters,
  type HiddenView,
  type ListingFilters,
} from '@/features/house-scanner/utils/listing-filters';

const HIDDEN_VIEWS: { value: HiddenView; label: string }[] = [
  { value: 'not-hidden', label: 'Not hidden' },
  { value: 'hidden-only', label: 'Hidden only' },
  { value: 'both', label: 'Both' },
];

const FRESHNESS_OPTIONS: {
  value: ListingFilters['freshness'];
  label: string;
}[] = [
  { value: 'all', label: 'All homes' },
  { value: 'latest-scan', label: 'New in latest scan per source' },
  { value: '1-day', label: 'First found in the last day' },
  { value: '3-days', label: 'First found in the last 3 days' },
  { value: '7-days', label: 'First found in the last 7 days' },
];

interface ListingFilterPanelProps {
  // The Filters toggle lives in the listings controls row.
  open: boolean;
  filters: ListingFilters;
  onChange: (filters: ListingFilters) => void;
  hosts: string[];
  shown: number;
  total: number;
  unassignedNeighborhoodCount: number;
}

export function ListingFilterPanel({
  open,
  filters,
  onChange,
  hosts,
  shown,
  total,
  unassignedNeighborhoodCount,
}: ListingFilterPanelProps) {
  function price(label: string, key: 'minPriceSek' | 'maxPriceSek') {
    return (
      <NumberInput
        aria-label={`${label} price (SEK)`}
        placeholder={label === 'Min' ? 'No min' : 'No max'}
        value={filters[key] ?? ''}
        onChange={(value) =>
          onChange({
            ...filters,
            [key]: typeof value === 'number' ? value : null,
          })
        }
        // Typing 4500000 shows 4 500 000, as prices are written everywhere else in the app.
        thousandSeparator=" "
        allowDecimal={false}
        allowNegative={false}
        min={0}
        hideControls
      />
    );
  }
  // A min and a max side by side under one heading, so a phone shows two fields per row instead of four.
  function pair(heading: string, fields: React.ReactNode) {
    return (
      <Stack gap={4} flex="1 1 15rem">
        <Text size="sm" fw={700}>
          {heading}
        </Text>
        <SimpleGrid cols={2} spacing="xs">
          {fields}
        </SimpleGrid>
      </Stack>
    );
  }
  function flag(
    label: string,
    key:
      | 'outdoorOnly'
      | 'aboveGroundOnly'
      | 'liftOnly'
      | 'glazedOnly'
      | 'notOnMapOnly'
      | 'showDuplicates'
      | 'includeUnknown',
  ) {
    return (
      <Checkbox
        label={label}
        checked={filters[key]}
        onChange={(event) =>
          onChange({ ...filters, [key]: event.currentTarget.checked })
        }
      />
    );
  }
  return (
    <Collapse expanded={open} id="listing-filters">
      <Stack gap="sm">
        <Flex gap="sm" wrap="wrap">
          {pair(
            'Price (SEK)',
            <>
              {price('Min', 'minPriceSek')}
              {price('Max', 'maxPriceSek')}
            </>,
          )}
          {pair(
            'Living area',
            <>
              <NumberSelect
                ariaLabel="Min living area (m²)"
                value={filters.minAreaM2}
                onChange={(minAreaM2) => onChange({ ...filters, minAreaM2 })}
                options={AREA_OPTIONS}
                format={formatArea}
                anyLabel="No min"
              />
              <NumberSelect
                ariaLabel="Max living area (m²)"
                value={filters.maxAreaM2}
                onChange={(maxAreaM2) => onChange({ ...filters, maxAreaM2 })}
                options={AREA_OPTIONS}
                format={formatArea}
                anyLabel="No max"
              />
            </>,
          )}
          <Stack gap={4} flex="1 1 15rem">
            <NumberSelect
              label="Minimum rooms"
              value={filters.minRooms}
              onChange={(minRooms) => onChange({ ...filters, minRooms })}
              options={ROOM_OPTIONS}
              format={formatRooms}
              anyLabel="Any"
            />
          </Stack>
          <Select
            label="Viewing within"
            value={
              filters.viewingWithinDays === null
                ? 'any'
                : String(filters.viewingWithinDays)
            }
            onChange={(value) =>
              onChange({
                ...filters,
                viewingWithinDays:
                  value === null || value === 'any' ? null : Number(value),
              })
            }
            data={[
              { value: 'any', label: 'Any time' },
              { value: '3', label: 'Next 3 days' },
              { value: '7', label: 'Next 7 days' },
              { value: '14', label: 'Next 14 days' },
            ]}
            comboboxProps={{ withinPortal: false }}
            flex="1 1 15rem"
          />
          <MultiSelect
            label="Sources"
            placeholder={filters.hosts.length === 0 ? 'All sources' : undefined}
            clearable
            value={filters.hosts}
            onChange={(selected) => onChange({ ...filters, hosts: selected })}
            data={hosts}
            comboboxProps={{ withinPortal: false }}
            flex="1 1 15rem"
          />
          <Select
            label="Latest"
            value={filters.freshness}
            onChange={(value) =>
              onChange({
                ...filters,
                freshness:
                  FRESHNESS_OPTIONS.find((option) => option.value === value)
                    ?.value ?? 'all',
              })
            }
            data={FRESHNESS_OPTIONS}
            comboboxProps={{ withinPortal: false }}
            flex="1 1 15rem"
          />
          <MultiSelect
            label="Neighborhoods"
            description="Includes homes near a selected neighborhood when their position is approximate."
            placeholder="All neighborhoods"
            searchable
            clearable
            value={filters.neighborhoodIds}
            onChange={(neighborhoodIds) =>
              onChange({ ...filters, neighborhoodIds })
            }
            data={neighborhoods.map(({ id, name }) => ({
              value: id,
              label: name,
            }))}
            nothingFoundMessage="No matching neighborhoods"
            comboboxProps={{ withinPortal: false }}
            flex="1 1 15rem"
          />
        </Flex>
        <Checkbox
          label="Include homes with no neighborhood assigned"
          description={`${unassignedNeighborhoodCount} homes have no neighborhood assigned. Applies when neighborhoods are selected.`}
          checked={filters.includeUnassignedNeighborhoods}
          onChange={(event) =>
            onChange({
              ...filters,
              includeUnassignedNeighborhoods: event.currentTarget.checked,
            })
          }
        />
        <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md">
          <Stack gap="xs">
            <Text size="sm" fw={700}>
              Only homes with
            </Text>
            {flag('Balcony or terrace', 'outdoorOnly')}
            {flag('Above ground floor', 'aboveGroundOnly')}
            {flag('Lift', 'liftOnly')}
            {flag('Glazed', 'glazedOnly')}
          </Stack>
          <Stack gap="xs">
            <Text size="sm" fw={700}>
              Also
            </Text>
            {flag('Not on the map only', 'notOnMapOnly')}
            {flag('Show duplicate listings', 'showDuplicates')}
            {flag('Keep unknown or disputed values', 'includeUnknown')}
          </Stack>
        </SimpleGrid>
        <Radio.Group
          label="Hidden homes"
          value={filters.hidden}
          onChange={(value) =>
            onChange({
              ...filters,
              hidden:
                HIDDEN_VIEWS.find((view) => view.value === value)?.value ??
                emptyFilters.hidden,
            })
          }
        >
          <Flex gap="md" wrap="wrap">
            {HIDDEN_VIEWS.map(({ value, label }) => (
              <Radio key={value} value={value} label={label} />
            ))}
          </Flex>
        </Radio.Group>
        <Flex gap="sm" align="center" wrap="wrap">
          <Button variant="default" onClick={() => onChange(emptyFilters)}>
            Clear filters
          </Button>
          <Text size="sm" role="status">
            Showing {shown} of {total} homes
          </Text>
        </Flex>
      </Stack>
    </Collapse>
  );
}
