import { Button, Group, Popover, Stack, Text } from '@mantine/core';
import { useState } from 'react';

import { classes } from '@/features/house-scanner/theme/shellter-theme';

const PIN_EXAMPLES = [
  { description: 'Not saved', text: '2,8M', className: '' },
  { description: 'Saved by you', text: '2,8M', className: classes.savedByMe },
  {
    description: 'Saved by another member',
    text: '2,8M',
    className: classes.savedByHousehold,
  },
  { description: 'Selected', text: '2,8M', className: '', checked: true },
  {
    description: 'Some homes selected',
    text: '3',
    className: '',
    checked: true,
    partial: true,
  },
];

export function MapPinGuide() {
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
          Pin guide
        </Button>
      </Popover.Target>
      <Popover.Dropdown
        role="dialog"
        aria-label="Pin guide"
        className={classes.pinGuide}
      >
        <Stack gap="xs">
          <Group justify="space-between">
            <Text size="sm" fw={600}>
              Pin guide
            </Text>
            <Button
              size="xs"
              variant="subtle"
              className={classes.guideButton}
              onClick={() => setOpened(false)}
            >
              Close
            </Button>
          </Group>
          <Stack gap={0}>
            {PIN_EXAMPLES.map((example) => (
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
            <Text size="xs">2,8M = 2.8 million SEK</Text>
            <Text size="xs">850k = 850,000 SEK</Text>
            <Text size="xs">? = Price unknown or disputed</Text>
          </Stack>
          <Stack gap={2}>
            <Text size="xs">
              Numbers count grouped homes. Tap to zoom or choose.
            </Text>
            <Text size="xs">
              Group fill shows whether anyone saved a home in it.
            </Text>
            <Text size="xs">Faded = hidden</Text>
            <Text size="xs">Check Details for location accuracy.</Text>
          </Stack>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
