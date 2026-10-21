import { Button, Modal, Stack, Text } from '@mantine/core';
import { useState } from 'react';

const ABOUT = [
  'Shellter follows apartments for sale in Göteborg.',
  'The settings below are your default filter for the Listings tab. Adjust budget, size, rooms, features and areas to fit what you are looking for.',
  'Filters on the Listings tab are yours alone and reset when you reload. Only owners can change these defaults.',
];

/** A button that opens a short explanation of what Shellter is and how the settings are used. */
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
        title="About Shellter"
        size="md"
      >
        <Stack gap="xs">
          {ABOUT.map((line) => (
            <Text key={line} size="sm">
              {line}
            </Text>
          ))}
        </Stack>
      </Modal>
    </>
  );
}
