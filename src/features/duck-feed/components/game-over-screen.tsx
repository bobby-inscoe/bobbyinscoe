import {
  Box,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { AvatarArt } from '@/features/duck-feed/components/avatar-art';
import type { Avatar, RoundResult } from '@/features/duck-feed/types/game';
import {
  INITIALS_LENGTH,
  sanitizeInitials,
} from '@/features/duck-feed/utils/high-scores';

interface GameOverScreenProps {
  avatar: Avatar;
  result: RoundResult;
  onSaveScore: (initials: string) => void;
  onPlayAgain: () => void;
  onChangeSettings: () => void;
}

export function GameOverScreen({
  avatar,
  result,
  onSaveScore,
  onPlayAgain,
  onChangeSettings,
}: GameOverScreenProps) {
  const [initials, setInitials] = useState('');
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isEnteringInitials = result.isNewHighScore && savedAs === null;

  // The round just ended and the hands are on the mouse, so jump straight to
  // the field: arcade initials are typed, not clicked into.
  useEffect(() => {
    if (isEnteringInitials) inputRef.current?.focus();
  }, [isEnteringInitials]);

  return (
    <Stack
      className="GameOverScreen"
      role="status"
      aria-labelledby="duck-feed-game-over-heading"
      align="center"
      justify="center"
      gap="md"
      p="lg"
    >
      <AvatarArt avatar={avatar} />
      <Title order={2} id="duck-feed-game-over-heading" size="h2">
        Round over!
      </Title>
      <Text size="xl" fw={600}>
        {result.score} points
      </Text>
      {result.isNewHighScore && (
        <Text c="flax.3" fw={600}>
          New high score!
        </Text>
      )}
      <Group component="dl" justify="center" gap="xl">
        <Box>
          <Text component="dt" size="sm">
            Best combo
          </Text>
          <Text component="dd">x{result.bestCombo}</Text>
        </Box>
        <Box>
          <Text component="dt" size="sm">
            Bonus time gained
          </Text>
          <Text component="dd">
            {(result.bonusTimeGainedMs / 1000).toFixed(2)}s
          </Text>
        </Box>
      </Group>
      {isEnteringInitials ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (initials.length !== INITIALS_LENGTH) return;
            onSaveScore(initials);
            setSavedAs(initials);
          }}
        >
          <Group align="flex-end" justify="center">
            {/* No maxLength: the attribute would reject a key typed right after a stripped character, before the sanitised value re-renders. */}
            <TextInput
              ref={inputRef}
              label="Enter your initials"
              value={initials}
              onChange={(event) =>
                setInitials(sanitizeInitials(event.currentTarget.value))
              }
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              w={170}
              classNames={{ label: 'game-field-label', input: 'InitialsInput' }}
            />
            <Button
              type="submit"
              color="flax.2"
              disabled={initials.length !== INITIALS_LENGTH}
            >
              Save score
            </Button>
          </Group>
        </form>
      ) : (
        <>
          {savedAs !== null && <Text size="sm">Saved as {savedAs}</Text>}
          <Group justify="center">
            <Button color="flax.2" onClick={onPlayAgain}>
              Play Again
            </Button>
            <Button variant="outline" color="flax.2" onClick={onChangeSettings}>
              Change Settings
            </Button>
          </Group>
        </>
      )}
    </Stack>
  );
}
