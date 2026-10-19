import { Button, Modal, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';

import styles from '@/features/house-scanner/components/household-workspace.module.css';

const SECTIONS: { heading: string; lines: string[] }[] = [
  {
    heading: 'What gets collected',
    lines: [
      'Once a day the collector reads the for-sale listings of each source for the places in your list. Today that is Göteborg. New homes appear after the next daily run.',
      'A place that is not supported yet is greyed out in the list and brings in nothing.',
    ],
  },
  {
    heading: 'How a home is sorted',
    lines: [
      'Each home is compared with the saved criteria. The result decides which Match group it belongs to:',
      'Within budget: it fits everything and costs your preferred budget or less.',
      'Stretch budget: it fits everything and costs more than your preferred budget, up to your stretch budget.',
      'Close to your criteria: it misses one rule that can bend, such as a lift or a balcony.',
      'Missing info: a fact is unknown, so it cannot be judged yet.',
      'Links we added: homes pasted in by the household.',
      'Homes that break a hard rule (above the stretch budget, too small, too few rooms, wrong home type, outside the area) are left out.',
    ],
  },
  {
    heading: 'What each setting does',
    lines: [
      'Budget: preferred and stretch are the two price lines above.',
      'Living area and rooms: a home outside these limits is left out. Leave the maximum area on "No maximum" to allow any size.',
      'Apartments and houses: the home types you want to see.',
      'Apartment rules: ground floor, lift, balcony and glazed outdoor space. Missing one of these moves a home to "Close to your criteria" instead of removing it.',
      'Places to search: the areas the collector reads, and the areas a home can be in to count as inside your search.',
      'Search circle: a home also counts as inside your search when it sits within the radius of the centre point, even when its place is not on the list.',
    ],
  },
  {
    heading: 'When a fact is unknown',
    lines: [
      'A missing fact never removes a home. It shows as missing so you can check it with the broker.',
    ],
  },
  {
    heading: 'Criteria and filters',
    lines: [
      'The search criteria are shared by the household, and only owners can change them.',
      'Filters on the Listings tab are yours alone. They change what you see, not how homes are sorted, and they reset when you reload the page.',
    ],
  },
];

/** A button that opens a plain-language explanation of how the search criteria work. */
export function CriteriaHelp() {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Button
        variant="default"
        size="xs"
        aria-haspopup="dialog"
        onClick={() => setOpened(true)}
      >
        How does this work?
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title="How the search works"
        size="lg"
        // Rendered in place so the feature's scoped CSS variables still apply.
        withinPortal={false}
        classNames={{ root: styles.drawerRoot, inner: styles.drawerInner }}
      >
        <Stack gap="md">
          {SECTIONS.map(({ heading, lines }) => (
            <Stack key={heading} gap={4}>
              <Title order={3} size="h5">
                {heading}
              </Title>
              {lines.map((line) => (
                <Text key={line} size="sm">
                  {line}
                </Text>
              ))}
            </Stack>
          ))}
        </Stack>
      </Modal>
    </>
  );
}
