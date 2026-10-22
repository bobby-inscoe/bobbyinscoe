import { Button, Group, Popover, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { FormattedMessage, type IntlShape, useIntl } from 'react-intl';

import { classes } from '@/features/house-scanner/theme/shellter-theme';

const PIN_EXAMPLES = (intl: IntlShape) => [
  {
    description: intl.formatMessage({ id: 'listings.map.notSaved' }),
    text: `${intl.formatNumber(2.8)}M`,
    className: '',
  },
  {
    description: intl.formatMessage({ id: 'listings.map.savedByYou' }),
    text: `${intl.formatNumber(2.8)}M`,
    className: classes.savedByMe,
  },
  {
    description: intl.formatMessage({
      id: 'listings.map.savedByAnotherMember',
    }),
    text: `${intl.formatNumber(2.8)}M`,
    className: classes.savedByHousehold,
  },
  {
    description: intl.formatMessage({ id: 'listings.map.selected2' }),
    text: `${intl.formatNumber(2.8)}M`,
    className: '',
    checked: true,
  },
  {
    description: intl.formatMessage({ id: 'listings.map.someHomesSelected' }),
    text: '3',
    className: '',
    checked: true,
    partial: true,
  },
];

export function MapPinGuide() {
  const intl = useIntl();

  const [opened, setOpened] = useState(false);

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      width="min(340px, calc(100vw - 32px))"
      trapFocus
      returnFocus
    >
      <Popover.Target>
        <Button
          size="xs"
          variant="default"
          className={classes.guideButton}
          aria-expanded={opened}
          aria-haspopup="dialog"
          onClick={() => setOpened((value) => !value)}
        >
          <FormattedMessage id="listings.map.pinGuide" />
        </Button>
      </Popover.Target>
      <Popover.Dropdown
        role="dialog"
        aria-label={intl.formatMessage({ id: 'listings.map.pinGuide' })}
        className={classes.pinGuide}
      >
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" fw={600}>
              <FormattedMessage id="listings.map.pinGuide" />
            </Text>
            <Button
              size="xs"
              variant="subtle"
              className={classes.guideButton}
              onClick={() => setOpened(false)}
            >
              <FormattedMessage id="common.close" />
            </Button>
          </Group>
          <Stack gap={0}>
            {PIN_EXAMPLES(intl).map((example) => (
              <Group key={example.description} wrap="nowrap" gap="xs">
                <span className={classes.guideSwatchCell} aria-hidden="true">
                  <span
                    className={`${classes.marker} ${classes.guideSwatch} ${example.className}`}
                    data-selection-mode={example.checked || undefined}
                    data-batch-checked={example.checked || undefined}
                    data-batch-partial={example.partial || undefined}
                  >
                    {example.text}
                  </span>
                </span>
                <Text size="xs">{example.description}</Text>
              </Group>
            ))}
          </Stack>
          <Stack gap={2}>
            <Text size="xs">
              <FormattedMessage id="listings.map.28M28MillionSEK" />
            </Text>
            <Text size="xs">
              <FormattedMessage id="listings.map.850k850000SEK" />
            </Text>
            <Text size="xs">
              <FormattedMessage id="listings.map.priceUnknownOrDisputed" />
            </Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs">
              <FormattedMessage id="listings.map.numbersCountGroupedHomesTapToZoomOrChoose" />
            </Text>
            <Text size="xs">
              <FormattedMessage id="listings.map.groupFillShowsWhetherAnyoneSavedAHomeIn" />
            </Text>
            <Text size="xs">
              <FormattedMessage id="listings.map.fadedHidden" />
            </Text>
            <Text size="xs">
              <FormattedMessage id="listings.map.checkDetailsForLocationAccuracy" />
            </Text>
          </Stack>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
