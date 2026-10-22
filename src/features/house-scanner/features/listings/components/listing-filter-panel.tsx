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
import { FormattedMessage, type IntlShape, useIntl } from 'react-intl';
import neighborhoods from '@/features/house-scanner/assets/neighborhoods.json';
import { NumberSelect } from '@/features/house-scanner/components/number-select';
import { messageValue } from '@/features/house-scanner/i18n/catalogs';
import { displayLabel } from '@/features/house-scanner/i18n/display-labels';
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

const HIDDEN_VIEWS = (
  intl: IntlShape,
): { value: HiddenView; label: string }[] => [
  {
    value: 'not-hidden',
    label: intl.formatMessage({ id: 'listings.filters.notHidden' }),
  },
  {
    value: 'hidden-only',
    label: intl.formatMessage({ id: 'listings.filters.hiddenOnly' }),
  },
  { value: 'both', label: intl.formatMessage({ id: 'listings.filters.both' }) },
];

const FRESHNESS_OPTIONS = (
  intl: IntlShape,
): {
  value: ListingFilters['freshness'];
  label: string;
}[] => [
  {
    value: 'all',
    label: intl.formatMessage({ id: 'listings.filters.allHomes' }),
  },
  {
    value: 'latest-scan',
    label: intl.formatMessage({
      id: 'listings.filters.newInLatestScanPerSource',
    }),
  },
  {
    value: '1-day',
    label: intl.formatMessage({
      id: 'listings.filters.firstFoundInTheLastDay',
    }),
  },
  {
    value: '3-days',
    label: intl.formatMessage({
      id: 'listings.filters.firstFoundInTheLast3Days',
    }),
  },
  {
    value: '7-days',
    label: intl.formatMessage({
      id: 'listings.filters.firstFoundInTheLast7Days',
    }),
  },
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
  // The Match picker, which the listings tab sets; favorites has none.
  match?: React.ReactNode;
}

export function ListingFilterPanel({
  open,
  filters,
  onChange,
  hosts,
  shown,
  total,
  unassignedNeighborhoodCount,
  match,
}: ListingFilterPanelProps) {
  const intl = useIntl();

  function price(label: string, key: 'minPriceSek' | 'maxPriceSek') {
    return (
      <NumberInput
        aria-label={intl.formatMessage(
          { id: 'listings.filters.priceSEK' },
          { value0: messageValue(label) },
        )}
        placeholder={
          key === 'minPriceSek'
            ? intl.formatMessage({ id: 'listings.filters.noMin' })
            : intl.formatMessage({ id: 'listings.filters.noMax' })
        }
        value={filters[key] ?? ''}
        onChange={(value) =>
          onChange({
            ...filters,
            [key]: typeof value === 'number' ? value : null,
          })
        }
        // Typing 4500000 shows 4 500 000, as prices are written everywhere else in the app.
        thousandSeparator={intl.locale.startsWith('sv') ? ' ' : ','}
        allowDecimal={false}
        allowNegative={false}
        min={0}
        hideControls
        decimalSeparator={intl.locale.startsWith('sv') ? ',' : '.'}
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
        <Flex gap="sm" align="center" wrap="wrap">
          <Text size="sm" role="status">
            <FormattedMessage
              id="listings.filters.showingOfHomes"
              values={{
                value0: messageValue(shown),
                value1: messageValue(total),
              }}
            />
          </Text>
          <Button variant="default" onClick={() => onChange(emptyFilters)}>
            <FormattedMessage id="listings.filters.clearFilters" />
          </Button>
        </Flex>
        <Flex gap="sm" wrap="wrap">
          {match}
          {pair(
            intl.formatMessage({ id: 'listings.filters.priceSEK2' }),
            <>
              {price(
                intl.formatMessage({ id: 'listings.filters.min' }),
                'minPriceSek',
              )}
              {price(
                intl.formatMessage({ id: 'listings.filters.max' }),
                'maxPriceSek',
              )}
            </>,
          )}
          {pair(
            intl.formatMessage({ id: 'listings.filters.livingArea' }),
            <>
              <NumberSelect
                ariaLabel={intl.formatMessage({
                  id: 'listings.filters.minLivingAreaM',
                })}
                value={filters.minAreaM2}
                onChange={(minAreaM2) => onChange({ ...filters, minAreaM2 })}
                options={AREA_OPTIONS}
                format={(value) => formatArea(value, intl)}
                anyLabel={intl.formatMessage({ id: 'listings.filters.noMin' })}
              />
              <NumberSelect
                ariaLabel={intl.formatMessage({
                  id: 'listings.filters.maxLivingAreaM',
                })}
                value={filters.maxAreaM2}
                onChange={(maxAreaM2) => onChange({ ...filters, maxAreaM2 })}
                options={AREA_OPTIONS}
                format={(value) => formatArea(value, intl)}
                anyLabel={intl.formatMessage({ id: 'listings.filters.noMax' })}
              />
            </>,
          )}
          {pair(
            intl.formatMessage({ id: 'settings.criteria.roomsHeading' }),
            <>
              <NumberSelect
                ariaLabel={intl.formatMessage({
                  id: 'settings.criteria.minimumRooms',
                })}
                value={filters.minRooms}
                onChange={(minRooms) => onChange({ ...filters, minRooms })}
                options={ROOM_OPTIONS}
                format={(value) => formatRooms(value, intl)}
                anyLabel={intl.formatMessage({ id: 'listings.filters.noMin' })}
              />
              <NumberSelect
                ariaLabel={intl.formatMessage({
                  id: 'settings.criteria.maximumRooms',
                })}
                value={filters.maxRooms}
                onChange={(maxRooms) => onChange({ ...filters, maxRooms })}
                options={ROOM_OPTIONS}
                format={(value) => formatRooms(value, intl)}
                anyLabel={intl.formatMessage({ id: 'listings.filters.noMax' })}
              />
            </>,
          )}
          <Select
            label={intl.formatMessage({ id: 'listings.filters.viewingWithin' })}
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
              {
                value: 'any',
                label: intl.formatMessage({ id: 'listings.filters.anyTime' }),
              },
              {
                value: '3',
                label: intl.formatMessage({ id: 'listings.filters.next3Days' }),
              },
              {
                value: '7',
                label: intl.formatMessage({ id: 'listings.filters.next7Days' }),
              },
              {
                value: '14',
                label: intl.formatMessage({
                  id: 'listings.filters.next14Days',
                }),
              },
            ]}
            flex="1 1 15rem"
          />
          <MultiSelect
            label={intl.formatMessage({ id: 'listings.filters.sources' })}
            placeholder={
              filters.hosts.length === 0
                ? intl.formatMessage({ id: 'listings.filters.allSources' })
                : undefined
            }
            clearable
            value={filters.hosts}
            onChange={(selected) => onChange({ ...filters, hosts: selected })}
            data={hosts.map((value) => ({
              value,
              label: displayLabel(intl, value),
            }))}
            flex="1 1 15rem"
          />
          <Select
            label={intl.formatMessage({ id: 'listings.filters.latest' })}
            value={filters.freshness}
            onChange={(value) =>
              onChange({
                ...filters,
                freshness:
                  FRESHNESS_OPTIONS(intl).find(
                    (option) => option.value === value,
                  )?.value ?? 'all',
              })
            }
            data={FRESHNESS_OPTIONS(intl)}
            flex="1 1 15rem"
          />
          <MultiSelect
            label={intl.formatMessage({ id: 'listings.filters.neighborhoods' })}
            description={intl.formatMessage({
              id: 'listings.filters.includesHomesNearASelectedNeighborhoodWhenTheirPosition',
            })}
            placeholder={intl.formatMessage({
              id: 'listings.filters.allNeighborhoods',
            })}
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
            nothingFoundMessage={intl.formatMessage({
              id: 'listings.filters.noMatchingNeighborhoods',
            })}
            flex="1 1 15rem"
          />
        </Flex>
        <Checkbox
          label={intl.formatMessage({
            id: 'listings.filters.includeHomesWithNoNeighborhoodAssigned',
          })}
          description={intl.formatMessage(
            {
              id: 'listings.filters.homesHaveNoNeighborhoodAssignedAppliesWhenNeighborhoodsAre',
            },
            { value0: messageValue(unassignedNeighborhoodCount) },
          )}
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
              <FormattedMessage id="listings.filters.onlyHomesWith" />
            </Text>
            {flag(
              intl.formatMessage({ id: 'listings.filters.balconyOrTerrace' }),
              'outdoorOnly',
            )}
            {flag(
              intl.formatMessage({ id: 'listings.filters.aboveGroundFloor' }),
              'aboveGroundOnly',
            )}
            {flag(
              intl.formatMessage({ id: 'listings.filters.lift' }),
              'liftOnly',
            )}
            {flag(
              intl.formatMessage({ id: 'listings.filters.glazed' }),
              'glazedOnly',
            )}
          </Stack>
          <Stack gap="xs">
            <Text size="sm" fw={700}>
              <FormattedMessage id="listings.filters.also" />
            </Text>
            {flag(
              intl.formatMessage({ id: 'listings.filters.notOnTheMapOnly' }),
              'notOnMapOnly',
            )}
            {flag(
              intl.formatMessage({
                id: 'listings.filters.showDuplicateListings',
              }),
              'showDuplicates',
            )}
            {flag(
              intl.formatMessage({
                id: 'listings.filters.keepUnknownOrDisputedValues',
              }),
              'includeUnknown',
            )}
          </Stack>
        </SimpleGrid>
        <Radio.Group
          label={intl.formatMessage({ id: 'listings.filters.hiddenHomes' })}
          value={filters.hidden}
          onChange={(value) =>
            onChange({
              ...filters,
              hidden:
                HIDDEN_VIEWS(intl).find((view) => view.value === value)
                  ?.value ?? emptyFilters.hidden,
            })
          }
        >
          <Flex gap="md" wrap="wrap">
            {HIDDEN_VIEWS(intl).map(({ value, label }) => (
              <Radio key={value} value={value} label={label} />
            ))}
          </Flex>
        </Radio.Group>
      </Stack>
    </Collapse>
  );
}
