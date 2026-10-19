import { useCallback, useEffect, useRef, useState } from 'react';

export interface CountdownControls {
  remainingMs: number;
  isRunning: boolean;
  start: (durationMs: number) => void;
  pause: () => void;
  resume: () => void;
  addTime: (deltaMs: number) => void;
}

const DEFAULT_TICK_MS = 100;

/**
 * Timestamp-based countdown: remaining time is always derived from wall-clock
 * elapsed time, not decremented tick-by-tick, so it can't drift under a
 * throttled background tab. Owns exactly one interval, live only while running.
 */
export function useCountdown(
  onComplete: () => void,
  tickMs: number = DEFAULT_TICK_MS,
): CountdownControls {
  const [remainingMs, setRemainingMs] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const remainingAtSegmentStartRef = useRef(0);
  const segmentStartedAtRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - segmentStartedAtRef.current;
      const next = Math.max(remainingAtSegmentStartRef.current - elapsed, 0);
      setRemainingMs(next);
      if (next <= 0) {
        setIsRunning(false);
        onCompleteRef.current();
      }
    }, tickMs);

    return () => clearInterval(interval);
  }, [isRunning, tickMs]);

  const start = useCallback((durationMs: number) => {
    remainingAtSegmentStartRef.current = durationMs;
    segmentStartedAtRef.current = Date.now();
    setRemainingMs(durationMs);
    setIsRunning(true);
  }, []);

  const pause = useCallback(() => {
    setIsRunning((wasRunning) => {
      if (wasRunning) {
        const elapsed = Date.now() - segmentStartedAtRef.current;
        const remaining = Math.max(
          remainingAtSegmentStartRef.current - elapsed,
          0,
        );
        remainingAtSegmentStartRef.current = remaining;
        setRemainingMs(remaining);
      }
      return false;
    });
  }, []);

  const resume = useCallback(() => {
    segmentStartedAtRef.current = Date.now();
    setIsRunning(true);
  }, []);

  const addTime = useCallback((deltaMs: number) => {
    remainingAtSegmentStartRef.current += deltaMs;
    setRemainingMs((prev) => prev + deltaMs);
  }, []);

  return { remainingMs, isRunning, start, pause, resume, addTime };
}
