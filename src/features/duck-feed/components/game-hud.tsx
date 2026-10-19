import { Group, Progress, Stack, Text } from '@mantine/core';
import type React from 'react';

import { useNow } from '@/features/duck-feed/hooks/use-now';

type UrgencyTier = 'normal' | 'warning' | 'critical';

const WARNING_RATIO = 0.25;
const CRITICAL_RATIO = 0.1;
const BONUS_TICK_MS = 100;

function urgencyTier(remainingMs: number, durationMs: number): UrgencyTier {
  if (durationMs <= 0) return 'normal';
  const ratio = remainingMs / durationMs;
  if (ratio <= CRITICAL_RATIO) return 'critical';
  if (ratio <= WARNING_RATIO) return 'warning';
  return 'normal';
}

interface GameHudProps {
  score: number;
  comboCount: number;
  comboExpiresAt: number | null;
  comboWindowMs: number;
  remainingMs: number;
  durationMs: number;
  isBonusPhase: boolean;
  bonusPhaseEndsAt: number | null;
  bonusPhaseDurationMs: number;
  bestScore: number | null;
}

export function GameHud({
  score,
  comboCount,
  comboExpiresAt,
  comboWindowMs,
  remainingMs,
  durationMs,
  isBonusPhase,
  bonusPhaseEndsAt,
  bonusPhaseDurationMs,
  bestScore,
}: GameHudProps): React.JSX.Element {
  const secondsRemaining = Math.max(remainingMs, 0) / 1000;
  const isTrackingCombo = !isBonusPhase && comboExpiresAt !== null;
  const now = useNow(
    BONUS_TICK_MS,
    (isBonusPhase && bonusPhaseEndsAt !== null) || isTrackingCombo,
  );
  const bonusMsRemaining =
    bonusPhaseEndsAt !== null
      ? Math.max(bonusPhaseEndsAt - now, 0)
      : bonusPhaseDurationMs;
  const bonusProgress =
    bonusPhaseDurationMs > 0 ? bonusMsRemaining / bonusPhaseDurationMs : 0;
  const comboProgress =
    isTrackingCombo && comboWindowMs > 0
      ? Math.min(Math.max(comboExpiresAt - now, 0) / comboWindowMs, 1)
      : 0;

  return (
    <Stack className="GameHud" align="center" gap="xs" w="100%" maw={720}>
      <Group justify="center" gap="xl">
        <Stack align="center" gap={2}>
          <Text component="span" className="GameHud-label">
            Score
          </Text>
          <Text component="span" className="GameHud-value">
            {score}
          </Text>
        </Stack>
        {comboCount > 1 && (
          <Stack className="GameHud-combo" align="center" gap={2}>
            <Text component="span" className="GameHud-label">
              Combo
            </Text>
            <Text component="span" className="GameHud-value">
              x{comboCount}
            </Text>
          </Stack>
        )}
        <Stack
          align="center"
          gap={2}
          className={`GameHud-stat GameHud-timer GameHud-timer--${urgencyTier(remainingMs, durationMs)}${isBonusPhase ? ' GameHud-timer--paused' : ''}`}
        >
          <Text component="span" className="GameHud-label">
            {isBonusPhase ? 'Time (paused)' : 'Time'}
          </Text>
          <Text component="span" className="GameHud-value">
            {secondsRemaining.toFixed(1)}s
          </Text>
        </Stack>
        {isBonusPhase && (
          <Stack className="GameHud-bonus" align="center" gap={2}>
            <Text component="span" className="GameHud-label">
              Bonus phase
            </Text>
            <Text component="span" className="GameHud-value">
              {(bonusMsRemaining / 1000).toFixed(1)}s
            </Text>
          </Stack>
        )}
        {bestScore !== null && (
          <Stack align="center" gap={2}>
            <Text component="span" className="GameHud-label">
              Best
            </Text>
            <Text component="span" className="GameHud-value">
              {bestScore}
            </Text>
          </Stack>
        )}
      </Group>
      {isBonusPhase ? (
        <Progress
          value={bonusProgress * 100}
          color="grape.4"
          size={4}
          w="100%"
          maw={300}
          aria-label="Bonus phase remaining"
        />
      ) : (
        // Hidden rather than unmounted so the HUD keeps its height as combos
        // start and lapse.
        <Progress
          value={comboProgress * 100}
          color="flax.3"
          size={4}
          w="100%"
          maw={300}
          aria-label="Combo time remaining"
          style={{ visibility: isTrackingCombo ? 'visible' : 'hidden' }}
        />
      )}
    </Stack>
  );
}
