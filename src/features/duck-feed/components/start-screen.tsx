import {
  ActionIcon,
  Button,
  Group,
  Radio,
  Stack,
  Tooltip,
} from '@mantine/core';
import { Info, Snail } from 'lucide-react';
import { AvatarArt } from '@/features/duck-feed/components/avatar-art';
import { DuckIcon } from '@/features/duck-feed/components/icons/duck-icon';
import type { Avatar, Difficulty } from '@/features/duck-feed/types/game';
import {
  AVATAR_LABELS,
  AVATARS,
  SNAIL_COLOR,
} from '@/features/duck-feed/utils/avatars';
import {
  DIFFICULTIES,
  DIFFICULTY_SETTINGS,
  ROUND_DURATIONS_SECONDS,
  type RoundDurationSeconds,
} from '@/features/duck-feed/utils/difficulty';

const DIFFICULTY_EXPLANATION =
  'Higher difficulty reduces the distance that triggers an escape and shortens the combo window.';

interface StartScreenProps {
  avatar: Avatar;
  onAvatarChange: (avatar: Avatar) => void;
  difficulty: Difficulty;
  onDifficultyChange: (difficulty: Difficulty) => void;
  durationSeconds: RoundDurationSeconds;
  onDurationChange: (durationSeconds: RoundDurationSeconds) => void;
  canStart: boolean;
  onStart: () => void;
}

export function StartScreen({
  avatar,
  onAvatarChange,
  difficulty,
  onDifficultyChange,
  durationSeconds,
  onDurationChange,
  canStart,
  onStart,
}: StartScreenProps) {
  return (
    <Stack
      className="StartScreen"
      align="center"
      justify="center"
      gap="lg"
      p="lg"
    >
      <AvatarArt avatar={avatar} />
      <Radio.Group
        name="avatar"
        label="Avatar"
        value={avatar}
        onChange={(value) => {
          const next = AVATARS.find((item) => item === value);
          if (next) onAvatarChange(next);
        }}
        classNames={{ label: 'game-field-label' }}
      >
        <Group justify="center" gap="lg" pt="xs">
          {AVATARS.map((option) => (
            <Radio
              key={option}
              value={option}
              color="flax.3"
              iconColor="moss.9"
              label={
                <Group gap={6}>
                  {option === 'duck' ? (
                    <DuckIcon useOriginalArt size={20} />
                  ) : (
                    <Snail
                      size={20}
                      strokeWidth={1.75}
                      color={SNAIL_COLOR}
                      aria-hidden="true"
                    />
                  )}
                  {AVATAR_LABELS[option]}
                </Group>
              }
            />
          ))}
        </Group>
      </Radio.Group>
      <Radio.Group
        name="difficulty"
        label={
          <Group gap={6} justify="center">
            Difficulty
            <Tooltip
              label={DIFFICULTY_EXPLANATION}
              multiline
              w={260}
              events={{ hover: true, focus: true, touch: true }}
            >
              <ActionIcon
                variant="subtle"
                color="flax.2"
                size="sm"
                aria-label={DIFFICULTY_EXPLANATION}
              >
                <Info size={16} aria-hidden="true" />
              </ActionIcon>
            </Tooltip>
          </Group>
        }
        value={difficulty}
        onChange={(value) => {
          const next = DIFFICULTIES.find((item) => item === value);
          if (next) onDifficultyChange(next);
        }}
        classNames={{ label: 'game-field-label' }}
      >
        <Group justify="center" gap="md" pt="xs">
          {DIFFICULTIES.map((tier) => (
            <Radio
              key={tier}
              value={tier}
              color="flax.3"
              iconColor="moss.9"
              label={DIFFICULTY_SETTINGS[tier].label}
            />
          ))}
        </Group>
      </Radio.Group>
      <Radio.Group
        name="duration"
        label="Round length"
        value={String(durationSeconds)}
        onChange={(value) => {
          const next = ROUND_DURATIONS_SECONDS.find(
            (item) => String(item) === value,
          );
          if (next) onDurationChange(next);
        }}
        classNames={{ label: 'game-field-label' }}
      >
        <Group justify="center" gap="lg" pt="xs">
          {ROUND_DURATIONS_SECONDS.map((seconds) => (
            <Radio
              key={seconds}
              value={String(seconds)}
              color="flax.3"
              iconColor="moss.9"
              label={`${seconds}s`}
            />
          ))}
        </Group>
      </Radio.Group>
      <Button color="flax.2" onClick={onStart} disabled={!canStart}>
        {canStart ? 'Start Game' : 'Measuring board…'}
      </Button>
    </Stack>
  );
}
