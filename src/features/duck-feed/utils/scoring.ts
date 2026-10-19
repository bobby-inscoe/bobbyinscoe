export const BASE_FLEE_POINTS = 10;
export const COMBO_BONUS_POINTS = 5;
export const MAX_COMBO_MULTIPLIER = 8;

/** Points awarded for a flee, given the combo streak count it extends (1 = no streak yet). */
export function comboAward(comboCount: number): number {
  const cappedCombo = Math.min(comboCount, MAX_COMBO_MULTIPLIER);
  return BASE_FLEE_POINTS + (cappedCombo - 1) * COMBO_BONUS_POINTS;
}

export const BONUS_PICKUP_MIN_DELAY_MS = 6000;
export const BONUS_PICKUP_MAX_DELAY_MS = 12000;
export const BONUS_PICKUP_RADIUS_PX = 50;

export const BONUS_PHASE_DURATION_MS = 7000;
/** Crumbs in the flurry, maintained at all times: catching one immediately spawns its replacement. */
export const FLURRY_CRUMB_COUNT = 6;
export const CRUMB_PICKUP_RADIUS_PX = 40;
/** Minimum distance a freshly (re)spawned crumb must keep from the cursor. */
export const CRUMB_MIN_SEPARATION_PX = 40;
export const CRUMB_TIME_BONUS_MS = 100;

/** Ducks released by a fan pickup, spaced evenly around the full circle. */
export const SMALL_DUCK_COUNT = 8;
export const SMALL_DUCK_SIZE_PX = 24;
export const SMALL_DUCK_SPEED_PX_PER_S = 280;
/** Wall ricochets before a small duck flies off the board. */
export const SMALL_DUCK_MAX_BOUNCES = 2;
/** Center-to-center distance at which a small duck eats a feed item. */
export const SMALL_DUCK_CATCH_RADIUS_PX = 32;
/** Flat award, deliberately outside the combo so only the cursor feeds a streak. */
export const SMALL_DUCK_CATCH_POINTS = BASE_FLEE_POINTS;

/** How long a catch/time-bonus popup stays on screen before it's pruned. */
export const POPUP_LIFETIME_MS = 700;

export function randomDelayMs(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}
