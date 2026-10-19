import { Group, Stack, Text, Title } from '@mantine/core';
import type { HighScoreEntry } from '@/features/duck-feed/types/game';

export function HighScoreList({ scores }: { scores: HighScoreEntry[] }) {
  return (
    <Stack gap={6} align="center" w="100%">
      <Title order={2} ff="inherit" fz={13} tt="uppercase" c="flax.2">
        High Scores
      </Title>
      {scores.length === 0 ? (
        <Text size="sm" c="flax.2">
          No rounds played yet.
        </Text>
      ) : (
        <Stack
          component="ol"
          gap={3}
          p={0}
          w="100%"
          style={{ listStyle: 'none' }}
        >
          {scores.map((entry, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rank position is the stable identity, not the score value.
            <Group component="li" key={index} justify="space-between">
              <Group component="span" gap="sm" wrap="nowrap">
                <Text component="span" size="sm">
                  {index + 1}
                </Text>
                <Text component="span" size="sm" ff="monospace">
                  {entry.name}
                </Text>
              </Group>
              <Text component="span" size="sm">
                {entry.score}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
