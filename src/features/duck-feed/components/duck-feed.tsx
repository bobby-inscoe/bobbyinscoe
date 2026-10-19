import { Box, Paper, Stack, Title } from '@mantine/core';
import type React from 'react';
import { useState } from 'react';

import '@/features/duck-feed/components/duck-feed.css';

import { GameBoard } from '@/features/duck-feed/components/game-board';
import { GameHud } from '@/features/duck-feed/components/game-hud';
import { GameOverScreen } from '@/features/duck-feed/components/game-over-screen';
import { HighScoreList } from '@/features/duck-feed/components/high-score-list';
import { StartScreen } from '@/features/duck-feed/components/start-screen';
import { useDuckFeedGame } from '@/features/duck-feed/hooks/use-duck-feed-game';
import { useElementSize } from '@/features/duck-feed/hooks/use-element-size';
import { useHighScores } from '@/features/duck-feed/hooks/use-high-scores';
import type { Avatar, Difficulty } from '@/features/duck-feed/types/game';
import type { RoundDurationSeconds } from '@/features/duck-feed/utils/difficulty';

interface DuckFeedProps {
  className?: string;
}

const DEFAULT_ROUND_DURATION_SECONDS: RoundDurationSeconds = 30;

export function DuckFeed({ className }: DuckFeedProps): React.JSX.Element {
  const { ref: boardRef, size: boardSize } = useElementSize<HTMLDivElement>();
  const highScores = useHighScores();
  const [avatar, setAvatar] = useState<Avatar>('duck');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [durationSeconds, setDurationSeconds] = useState<RoundDurationSeconds>(
    DEFAULT_ROUND_DURATION_SECONDS,
  );

  const game = useDuckFeedGame({
    boardSize,
    difficulty,
    durationSeconds,
    qualifiesForHighScore: highScores.qualifies,
  });
  const lastResult = game.lastResult;

  return (
    <Stack className={`${className ?? ''} DuckFeed`} align="center" gap="md">
      <Title order={1} fz={{ base: 32, sm: 42 }}>
        Feed the Duck!
      </Title>
      {game.status !== 'idle' && (
        <GameHud
          score={game.score}
          comboCount={game.comboCount}
          comboExpiresAt={game.comboExpiresAt}
          comboWindowMs={game.comboWindowMs}
          remainingMs={game.remainingMs}
          durationMs={game.durationMs}
          isBonusPhase={game.status === 'bonus-phase'}
          bonusPhaseEndsAt={game.bonusPhaseEndsAt}
          bonusPhaseDurationMs={game.bonusPhaseDurationMs}
          bestScore={highScores.scores[0]?.score ?? null}
        />
      )}
      <Box className="DuckFeed-boardFrame">
        <GameBoard
          ref={boardRef}
          avatar={avatar}
          feedItems={game.feedItems}
          smallDucks={game.smallDucks}
          popups={game.popups}
          isBonusPhase={game.status === 'bonus-phase'}
          onPointerMove={game.handlePointerMove}
          onItemActivate={game.handleItemActivate}
        />
        {game.status === 'idle' && (
          <StartScreen
            avatar={avatar}
            onAvatarChange={setAvatar}
            difficulty={difficulty}
            onDifficultyChange={setDifficulty}
            durationSeconds={durationSeconds}
            onDurationChange={setDurationSeconds}
            canStart={boardSize.width > 0}
            onStart={game.start}
          />
        )}
        {game.status === 'game-over' && lastResult && (
          <GameOverScreen
            avatar={avatar}
            result={lastResult}
            onSaveScore={(name) => highScores.saveScore(name, lastResult.score)}
            onPlayAgain={game.start}
            onChangeSettings={game.returnToMenu}
          />
        )}
      </Box>
      {game.status === 'idle' && (
        <Paper
          w="100%"
          maw={260}
          px="md"
          py="sm"
          radius="md"
          bg="var(--secondary-dark)"
          c="inherit"
        >
          <HighScoreList scores={highScores.scores} />
        </Paper>
      )}
    </Stack>
  );
}
