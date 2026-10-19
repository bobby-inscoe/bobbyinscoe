import { useCallback, useEffect, useRef, useState } from 'react';

import type { HighScoreEntry } from '@/features/duck-feed/types/game';
import {
  HIGH_SCORES_STORAGE_KEY,
  insertHighScore,
  parseHighScores,
  wouldBeNewHighScore,
} from '@/features/duck-feed/utils/high-scores';

function readStoredHighScores(): HighScoreEntry[] {
  try {
    return parseHighScores(
      window.localStorage.getItem(HIGH_SCORES_STORAGE_KEY),
    );
  } catch {
    return [];
  }
}

export interface UseHighScoresResult {
  scores: HighScoreEntry[];
  /** Whether a finished round's score earns a place in the top 5. */
  qualifies: (score: number) => boolean;
  /** Adds a qualifying round to the table under the player's initials. */
  saveScore: (name: string, score: number) => void;
}

export function useHighScores(): UseHighScoresResult {
  const [scores, setScores] = useState<HighScoreEntry[]>(readStoredHighScores);
  const scoresRef = useRef(scores);
  scoresRef.current = scores;

  useEffect(() => {
    try {
      window.localStorage.setItem(
        HIGH_SCORES_STORAGE_KEY,
        JSON.stringify(scores),
      );
    } catch {
      // localStorage may be unavailable (private browsing, quota); scores just won't persist.
    }
  }, [scores]);

  const qualifies = useCallback(
    (score: number): boolean => wouldBeNewHighScore(scoresRef.current, score),
    [],
  );

  const saveScore = useCallback((name: string, score: number): void => {
    const updated = insertHighScore(scoresRef.current, { name, score });
    scoresRef.current = updated;
    setScores(updated);
  }, []);

  return { scores, qualifies, saveScore };
}
