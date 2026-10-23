import { Select, Text } from '@mantine/core';
import { FormattedMessage, useIntl } from 'react-intl';
import { NumberSelect } from '@/features/house-scanner/components/number-select';
import type { Criteria } from '@/features/house-scanner/types/contracts';
import {
  formatKm,
  isNear,
  MUNICIPALITIES,
  RADIUS_OPTIONS_KM,
  SEARCH_HUBS,
} from '@/features/house-scanner/utils/criteria-options';

export function SearchLocationFields({
  geography,
  disabled,
  onChange,
}: {
  geography: Criteria['geography'];
  disabled: boolean;
  onChange: (geography: Criteria['geography']) => void;
}) {
  const intl = useIntl();
  const hub = SEARCH_HUBS.find(({ center }) =>
    isNear(geography.center, center),
  );
  const location =
    geography.mode === 'municipalities' &&
    geography.municipalities.length === 1 &&
    MUNICIPALITIES.some(({ value }) => value === geography.municipalities[0])
      ? `city:${geography.municipalities[0]}`
      : geography.mode === 'radius' && hub
        ? `hub:${hub.value}`
        : 'current';
  return (
    <>
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
                    geography.mode === 'radius'
                      ? intl.formatMessage(
                          { id: 'settings.criteria.savedPoint' },
                          {
                            latitude: geography.center[1].toFixed(3),
                            longitude: geography.center[0].toFixed(3),
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
        disabled={disabled}
        onChange={(next) => {
          const selected = SEARCH_HUBS.find(
            ({ value }) => `hub:${value}` === next,
          );
          const city = MUNICIPALITIES.find(
            ({ value, supported }) => supported && `city:${value}` === next,
          );
          if (selected)
            onChange({
              ...geography,
              mode: 'radius',
              center: [...selected.center],
              municipalities: [selected.municipality],
            });
          else if (city)
            onChange({
              ...geography,
              mode: 'municipalities',
              municipalities: [city.value],
            });
        }}
      />
      {!geography.mode && (
        <Text size="sm" c="dimmed">
          <FormattedMessage
            id="settings.criteria.legacySearchDescription"
            values={{
              cities: geography.municipalities.join(', '),
              radius: formatKm(geography.radiusKm, intl),
            }}
          />
        </Text>
      )}
      {geography.mode === 'radius' && (
        <NumberSelect
          label={intl.formatMessage({ id: 'settings.criteria.radius' })}
          value={geography.radiusKm}
          onChange={(radiusKm) =>
            radiusKm !== null && onChange({ ...geography, radiusKm })
          }
          options={RADIUS_OPTIONS_KM}
          format={(value) => formatKm(value, intl)}
          disabled={disabled}
        />
      )}
    </>
  );
}
