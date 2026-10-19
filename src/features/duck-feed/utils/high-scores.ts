import type { HighScoreEntry } from '@/features/duck-feed/types/game';

export const HIGH_SCORE_LIMIT = 5;
export const HIGH_SCORES_STORAGE_KEY = 'duck-feed:high-scores';
export const INITIALS_LENGTH = 3;
/** Shown for scores saved before names existed, and for stored names that fail validation. */
export const ANONYMOUS_INITIALS = '---';

/** Uppercases and drops everything but A-Z, so arcade-style initials can't carry markup or emoji. */
export function sanitizeInitials(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, INITIALS_LENGTH);
}

function byScoreDescending(a: HighScoreEntry, b: HighScoreEntry): number {
  return b.score - a.score;
}

function parseEntry(value: unknown): HighScoreEntry | null {
  // Scores saved before names existed were bare numbers.
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { name: ANONYMOUS_INITIALS, score: value }
      : null;
  }

  if (typeof value !== 'object' || value === null) return null;
  const { name, score } = value as { name?: unknown; score?: unknown };
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;

  const initials = typeof name === 'string' ? sanitizeInitials(name) : '';
  return {
    name: initials.length === INITIALS_LENGTH ? initials : ANONYMOUS_INITIALS,
    score,
  };
}

/** Boundary validation: localStorage content is untrusted until each entry is proven well-formed. */
export function parseHighScores(raw: string | null): HighScoreEntry[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map(parseEntry)
    .filter((entry): entry is HighScoreEntry => entry !== null)
    .sort(byScoreDescending)
    .slice(0, HIGH_SCORE_LIMIT);
}

export function insertHighScore(
  entries: HighScoreEntry[],
  entry: HighScoreEntry,
): HighScoreEntry[] {
  return [...entries, entry].sort(byScoreDescending).slice(0, HIGH_SCORE_LIMIT);
}

/** A zero-point round never earns a place, so it never prompts for initials. */
export function wouldBeNewHighScore(
  entries: HighScoreEntry[],
  score: number,
): boolean {
  if (score <= 0) return false;
  if (entries.length < HIGH_SCORE_LIMIT) return true;
  const lowest = entries[entries.length - 1];
  return lowest === undefined || score > lowest.score;
}
