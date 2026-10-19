import type { Difficulty } from '@/features/duck-feed/types/game';

export interface DifficultySettings {
  label: string;
  /** Distance in px, at round start, at which the feed flees from the cursor. */
  fleeRadiusPx: number;
  /** Floor the flee radius escalates down to by the end of the round. */
  minFleeRadiusPx: number;
  /** Minimum time before the same feed item can flee again. */
  retriggerCooldownMs: number;
  /** How long a player has between flees to keep a combo streak alive. */
  comboWindowMs: number;
}

export const DIFFICULTY_SETTINGS: Record<Difficulty, DifficultySettings> = {
  easy: {
    label: 'Easy',
    fleeRadiusPx: 90,
    minFleeRadiusPx: 60,
    retriggerCooldownMs: 150,
    comboWindowMs: 2000,
  },
  normal: {
    label: 'Normal',
    fleeRadiusPx: 65,
    minFleeRadiusPx: 40,
    retriggerCooldownMs: 250,
    comboWindowMs: 1500,
  },
  hard: {
    label: 'Hard',
    fleeRadiusPx: 45,
    minFleeRadiusPx: 25,
    retriggerCooldownMs: 400,
    comboWindowMs: 1100,
  },
};

export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

export const ROUND_DURATIONS_SECONDS = [15, 30, 60] as const;
export type RoundDurationSeconds = (typeof ROUND_DURATIONS_SECONDS)[number];

/** Flee radius shrinks linearly toward the tier's floor as the round elapses. */
export function escalatedFleeRadius(
  settings: DifficultySettings,
  elapsedMs: number,
  totalMs: number,
): number {
  if (totalMs <= 0) return settings.fleeRadiusPx;
  const progress = Math.min(Math.max(elapsedMs / totalMs, 0), 1);
  const range = settings.fleeRadiusPx - settings.minFleeRadiusPx;
  return settings.fleeRadiusPx - range * progress;
}
