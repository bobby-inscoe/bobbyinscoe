import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { useCountdown } from '@/features/duck-feed/hooks/use-countdown';
import type {
  BoardSize,
  Difficulty,
  FeedItem,
  GameStatus,
  Popup,
  Position,
  RoundResult,
  SmallDuck,
} from '@/features/duck-feed/types/game';
import { FEED_ITEM_SIZE_PX } from '@/features/duck-feed/utils/constants';
import type { RoundDurationSeconds } from '@/features/duck-feed/utils/difficulty';
import {
  DIFFICULTY_SETTINGS,
  escalatedFleeRadius,
} from '@/features/duck-feed/utils/difficulty';
import {
  distance,
  itemCenter,
  randomPosition,
  randomPositionAwayFrom,
} from '@/features/duck-feed/utils/geometry';
import {
  BONUS_PHASE_DURATION_MS,
  BONUS_PICKUP_MAX_DELAY_MS,
  BONUS_PICKUP_MIN_DELAY_MS,
  BONUS_PICKUP_RADIUS_PX,
  CRUMB_MIN_SEPARATION_PX,
  CRUMB_PICKUP_RADIUS_PX,
  CRUMB_TIME_BONUS_MS,
  comboAward,
  FLURRY_CRUMB_COUNT,
  POPUP_LIFETIME_MS,
  randomDelayMs,
  SMALL_DUCK_CATCH_POINTS,
  SMALL_DUCK_CATCH_RADIUS_PX,
  SMALL_DUCK_SIZE_PX,
} from '@/features/duck-feed/utils/scoring';
import {
  spawnSmallDuckFan,
  stepSmallDuck,
} from '@/features/duck-feed/utils/small-ducks';

interface GameState {
  status: GameStatus;
  score: number;
  comboCount: number;
  bestCombo: number;
  bonusTimeGainedMs: number;
  /** When the live combo lapses; display-only, `lastFleeAtRef` decides the actual reset. */
  comboExpiresAt: number | null;
  feed: FeedItem[];
  /** Whichever pickup (bonus or fan) is on the board; one at a time. */
  bonusPickup: FeedItem | null;
  crumbs: FeedItem[];
  smallDucks: SmallDuck[];
  bonusPhaseEndsAt: number | null;
  popups: Popup[];
  lastResult: RoundResult | null;
}

const initialState: GameState = {
  status: 'idle',
  score: 0,
  comboCount: 0,
  bestCombo: 0,
  bonusTimeGainedMs: 0,
  comboExpiresAt: null,
  feed: [],
  bonusPickup: null,
  crumbs: [],
  smallDucks: [],
  bonusPhaseEndsAt: null,
  popups: [],
  lastResult: null,
};

function spawnCrumb(board: BoardSize, avoid: Position, now: number): FeedItem {
  return {
    id: crypto.randomUUID(),
    kind: 'crumb',
    position: randomPositionAwayFrom(board, avoid, CRUMB_MIN_SEPARATION_PX),
    lastMovedAt: now,
  };
}

type Action =
  | { type: 'start'; feed: FeedItem[] }
  | {
      type: 'relocate-feed';
      id: string;
      position: Position;
      now: number;
      points: number;
      comboCount: number;
      comboExpiresAt: number;
    }
  | { type: 'reset-combo' }
  | { type: 'spawn-bonus-pickup'; item: FeedItem }
  | { type: 'collect-fan-pickup'; ducks: SmallDuck[] }
  | { type: 'step-small-ducks'; ducks: SmallDuck[] }
  | {
      type: 'small-duck-catch';
      id: string;
      position: Position;
      now: number;
      points: number;
    }
  | {
      type: 'collect-bonus-pickup';
      crumbs: FeedItem[];
      bonusPhaseEndsAt: number;
    }
  | { type: 'collect-crumbs'; caughtIds: string[]; replacements: FeedItem[] }
  | { type: 'end-bonus-phase'; comboExpiresAt: number }
  | { type: 'add-popup'; popup: Popup }
  | { type: 'prune-popups'; now: number }
  | { type: 'end-round'; isNewHighScore: boolean }
  | { type: 'return-to-idle' };

function gameReducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'start':
      return { ...initialState, status: 'playing', feed: action.feed };
    case 'relocate-feed': {
      if (!state.feed.some((item) => item.id === action.id)) return state;
      return {
        ...state,
        feed: state.feed.map((item) =>
          item.id === action.id
            ? { ...item, position: action.position, lastMovedAt: action.now }
            : item,
        ),
        score: state.score + action.points,
        comboCount: action.comboCount,
        comboExpiresAt: action.comboExpiresAt,
        bestCombo: Math.max(state.bestCombo, action.comboCount),
      };
    }
    case 'small-duck-catch': {
      if (!state.feed.some((item) => item.id === action.id)) return state;
      return {
        ...state,
        feed: state.feed.map((item) =>
          item.id === action.id
            ? { ...item, position: action.position, lastMovedAt: action.now }
            : item,
        ),
        score: state.score + action.points,
      };
    }
    case 'reset-combo':
      return { ...state, comboCount: 0, comboExpiresAt: null };
    case 'spawn-bonus-pickup':
      return { ...state, bonusPickup: action.item };
    case 'collect-fan-pickup':
      return {
        ...state,
        bonusPickup: null,
        smallDucks: [...state.smallDucks, ...action.ducks],
      };
    case 'step-small-ducks':
      return { ...state, smallDucks: action.ducks };
    case 'collect-bonus-pickup':
      return {
        ...state,
        status: 'bonus-phase',
        bonusPickup: null,
        crumbs: action.crumbs,
        bonusPhaseEndsAt: action.bonusPhaseEndsAt,
      };
    case 'collect-crumbs':
      return {
        ...state,
        crumbs: [
          ...state.crumbs.filter((c) => !action.caughtIds.includes(c.id)),
          ...action.replacements,
        ],
        bonusTimeGainedMs:
          state.bonusTimeGainedMs +
          CRUMB_TIME_BONUS_MS * action.caughtIds.length,
      };
    case 'end-bonus-phase':
      return {
        ...state,
        status: 'playing',
        crumbs: [],
        bonusPhaseEndsAt: null,
        comboExpiresAt: state.comboCount > 0 ? action.comboExpiresAt : null,
      };
    case 'add-popup':
      return { ...state, popups: [...state.popups, action.popup] };
    case 'prune-popups':
      return {
        ...state,
        popups: state.popups.filter(
          (popup) => action.now - popup.createdAt < POPUP_LIFETIME_MS,
        ),
      };
    case 'end-round':
      return {
        ...state,
        status: 'game-over',
        smallDucks: [],
        lastResult: {
          score: state.score,
          bestCombo: state.bestCombo,
          bonusTimeGainedMs: state.bonusTimeGainedMs,
          isNewHighScore: action.isNewHighScore,
        },
      };
    case 'return-to-idle':
      return { ...initialState };
    default:
      return state;
  }
}

const GAME_TICK_MS = 150;
const SMALL_DUCK_TICK_MS = 50;
/** A backgrounded tab throttles timers; cap the catch-up so ducks do not teleport. */
const SMALL_DUCK_MAX_STEP_MS = 100;

export interface UseDuckFeedGameOptions {
  boardSize: BoardSize;
  difficulty: Difficulty;
  durationSeconds: RoundDurationSeconds;
  qualifiesForHighScore: (score: number) => boolean;
}

export interface UseDuckFeedGameResult {
  status: GameStatus;
  score: number;
  comboCount: number;
  comboExpiresAt: number | null;
  comboWindowMs: number;
  smallDucks: SmallDuck[];
  remainingMs: number;
  durationMs: number;
  bonusPhaseEndsAt: number | null;
  bonusPhaseDurationMs: number;
  feedItems: FeedItem[];
  popups: Popup[];
  lastResult: RoundResult | null;
  start: () => void;
  returnToMenu: () => void;
  handlePointerMove: (position: Position) => void;
  handleItemActivate: (id: string) => void;
}

export function useDuckFeedGame(
  options: UseDuckFeedGameOptions,
): UseDuckFeedGameResult {
  const { boardSize, difficulty, durationSeconds, qualifiesForHighScore } =
    options;
  const [state, dispatch] = useReducer(gameReducer, initialState);

  // Latest-value refs so the interval and pointer-move handler below never
  // close over stale state or props.
  const stateRef = useRef(state);
  stateRef.current = state;
  const boardSizeRef = useRef(boardSize);
  boardSizeRef.current = boardSize;
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;
  const durationMsRef = useRef(durationSeconds * 1000);
  durationMsRef.current = durationSeconds * 1000;
  const qualifiesForHighScoreRef = useRef(qualifiesForHighScore);
  qualifiesForHighScoreRef.current = qualifiesForHighScore;

  const lastFleeAtRef = useRef(0);
  const nextBonusPickupAtRef = useRef(0);

  const handleRoundComplete = useCallback(() => {
    const isNewHighScore = qualifiesForHighScoreRef.current(
      stateRef.current.score,
    );
    dispatch({ type: 'end-round', isNewHighScore });
  }, []);

  const countdown = useCountdown(handleRoundComplete);
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;

  const start = useCallback(() => {
    const now = Date.now();
    const first: FeedItem = {
      id: crypto.randomUUID(),
      kind: 'normal',
      position: randomPosition(boardSizeRef.current),
      lastMovedAt: now,
    };
    const feed: FeedItem[] = [
      first,
      {
        id: crypto.randomUUID(),
        kind: 'normal',
        position: randomPositionAwayFrom(
          boardSizeRef.current,
          itemCenter(first.position),
          FEED_ITEM_SIZE_PX,
        ),
        lastMovedAt: now,
      },
    ];
    lastFleeAtRef.current = 0;
    nextBonusPickupAtRef.current =
      now + randomDelayMs(BONUS_PICKUP_MIN_DELAY_MS, BONUS_PICKUP_MAX_DELAY_MS);
    dispatch({ type: 'start', feed });
    countdownRef.current.start(durationMsRef.current);
  }, []);

  const returnToMenu = useCallback(() => {
    dispatch({ type: 'return-to-idle' });
  }, []);

  const evaluateProximity = useCallback(
    (pointer: Position, activatedId?: string) => {
      const current = stateRef.current;
      const now = Date.now();

      if (current.status === 'playing') {
        const settings = DIFFICULTY_SETTINGS[difficultyRef.current];
        const elapsedMs = Math.max(
          durationMsRef.current - countdownRef.current.remainingMs,
          0,
        );
        const radius = escalatedFleeRadius(
          settings,
          elapsedMs,
          durationMsRef.current,
        );
        const nearbyFeed = current.feed
          .filter(
            (item) =>
              (!activatedId || item.id === activatedId) &&
              now - item.lastMovedAt >= settings.retriggerCooldownMs &&
              distance(pointer, itemCenter(item.position)) <= radius,
          )
          .sort(
            (a, b) =>
              distance(pointer, itemCenter(a.position)) -
              distance(pointer, itemCenter(b.position)),
          )[0];

        if (nearbyFeed) {
          const withinComboWindow =
            lastFleeAtRef.current > 0 &&
            now - lastFleeAtRef.current <= settings.comboWindowMs;
          const comboCount = withinComboWindow ? current.comboCount + 1 : 1;
          const position = randomPositionAwayFrom(
            boardSizeRef.current,
            [
              pointer,
              ...current.feed
                .filter((item) => item.id !== nearbyFeed.id)
                .map((item) => itemCenter(item.position)),
              ...(current.bonusPickup
                ? [itemCenter(current.bonusPickup.position)]
                : []),
            ],
            Math.max(radius, FEED_ITEM_SIZE_PX),
          );
          lastFleeAtRef.current = now;
          dispatch({
            type: 'relocate-feed',
            id: nearbyFeed.id,
            position,
            now,
            points: comboAward(comboCount),
            comboCount,
            comboExpiresAt: now + settings.comboWindowMs,
          });
          dispatch({
            type: 'add-popup',
            popup: {
              id: crypto.randomUUID(),
              kind: 'catch',
              position: pointer,
              createdAt: now,
            },
          });
          return;
        }

        if (
          current.bonusPickup &&
          distance(pointer, itemCenter(current.bonusPickup.position)) <=
            BONUS_PICKUP_RADIUS_PX
        ) {
          if (current.bonusPickup.kind === 'fan-pickup') {
            nextBonusPickupAtRef.current =
              now +
              randomDelayMs(
                BONUS_PICKUP_MIN_DELAY_MS,
                BONUS_PICKUP_MAX_DELAY_MS,
              );
            dispatch({
              type: 'collect-fan-pickup',
              ducks: spawnSmallDuckFan(
                itemCenter(current.bonusPickup.position),
              ),
            });
            return;
          }
          const crumbs = Array.from({ length: FLURRY_CRUMB_COUNT }, () =>
            spawnCrumb(boardSizeRef.current, pointer, now),
          );
          countdownRef.current.pause();
          dispatch({
            type: 'collect-bonus-pickup',
            crumbs,
            bonusPhaseEndsAt: now + BONUS_PHASE_DURATION_MS,
          });
        }
        return;
      }

      if (current.status === 'bonus-phase' && current.crumbs.length > 0) {
        const caught = current.crumbs.filter(
          (crumb) =>
            distance(pointer, itemCenter(crumb.position)) <=
            CRUMB_PICKUP_RADIUS_PX,
        );
        if (caught.length === 0) return;

        const replacements = caught.map(() =>
          spawnCrumb(boardSizeRef.current, pointer, now),
        );
        countdownRef.current.addTime(CRUMB_TIME_BONUS_MS * caught.length);
        dispatch({
          type: 'collect-crumbs',
          caughtIds: caught.map((crumb) => crumb.id),
          replacements,
        });
        for (const crumb of caught) {
          dispatch({
            type: 'add-popup',
            popup: {
              id: crypto.randomUUID(),
              kind: 'time-bonus',
              position: itemCenter(crumb.position),
              createdAt: now,
            },
          });
        }
      }
    },
    [],
  );

  const handleItemActivate = useCallback(
    (id: string) => {
      const current = stateRef.current;
      const candidates = [
        ...current.feed,
        current.bonusPickup,
        ...current.crumbs,
      ];
      const item = candidates.find((candidate) => candidate?.id === id);
      if (item) evaluateProximity(itemCenter(item.position), id);
    },
    [evaluateProximity],
  );

  // Everything time-based (combo expiry, bonus-pickup spawning, bonus-phase
  // expiry, popup cleanup) runs off this clock instead of pointer events, so
  // it stays correct even if the cursor never moves.
  useEffect(() => {
    if (state.status === 'idle' || state.status === 'game-over') return;

    const interval = setInterval(() => {
      const now = Date.now();
      const current = stateRef.current;

      if (
        current.popups.some(
          (popup) => now - popup.createdAt >= POPUP_LIFETIME_MS,
        )
      ) {
        dispatch({ type: 'prune-popups', now });
      }

      if (current.status === 'playing') {
        const settings = DIFFICULTY_SETTINGS[difficultyRef.current];
        if (
          current.comboCount > 0 &&
          now - lastFleeAtRef.current > settings.comboWindowMs
        ) {
          dispatch({ type: 'reset-combo' });
        }
        if (!current.bonusPickup && now >= nextBonusPickupAtRef.current) {
          const avoid = current.feed.map((item) => itemCenter(item.position));
          const item: FeedItem = {
            id: crypto.randomUUID(),
            kind: Math.random() < 0.5 ? 'fan-pickup' : 'bonus-pickup',
            position: randomPositionAwayFrom(
              boardSizeRef.current,
              avoid,
              FEED_ITEM_SIZE_PX,
            ),
            lastMovedAt: now,
          };
          dispatch({ type: 'spawn-bonus-pickup', item });
        }
        return;
      }

      if (
        current.status === 'bonus-phase' &&
        current.bonusPhaseEndsAt !== null &&
        now >= current.bonusPhaseEndsAt
      ) {
        countdownRef.current.resume();
        nextBonusPickupAtRef.current =
          now +
          randomDelayMs(BONUS_PICKUP_MIN_DELAY_MS, BONUS_PICKUP_MAX_DELAY_MS);
        // Treat the moment play resumes as a fresh flee for combo-timing
        // purposes, so the enforced pause doesn't cost the player their streak.
        lastFleeAtRef.current = now;
        dispatch({
          type: 'end-bonus-phase',
          comboExpiresAt:
            now + DIFFICULTY_SETTINGS[difficultyRef.current].comboWindowMs,
        });
      }
    }, GAME_TICK_MS);

    return () => clearInterval(interval);
  }, [state.status]);

  const hasSmallDucks = state.smallDucks.length > 0;
  const isRoundLive =
    state.status === 'playing' || state.status === 'bonus-phase';

  // Own clock, faster than the game tick, because a duck covers ~14px per
  // 50ms and a coarser step would visibly stutter and skip past feed items.
  useEffect(() => {
    if (!hasSmallDucks || !isRoundLive) return;

    let lastStepAt = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsedMs = Math.min(now - lastStepAt, SMALL_DUCK_MAX_STEP_MS);
      lastStepAt = now;
      const current = stateRef.current;
      const board = boardSizeRef.current;

      const ducks = current.smallDucks.flatMap((duck) => {
        const next = stepSmallDuck(duck, elapsedMs, board);
        return next ? [next] : [];
      });
      dispatch({ type: 'step-small-ducks', ducks });

      // The feed is muted during the bonus phase, so ducks only eat while
      // normal play is running.
      if (current.status !== 'playing') return;

      const eatenIds = new Set<string>();
      for (const duck of ducks) {
        const duckCenter = itemCenter(duck.position, SMALL_DUCK_SIZE_PX);
        const target = current.feed.find(
          (item) =>
            !eatenIds.has(item.id) &&
            distance(duckCenter, itemCenter(item.position)) <=
              SMALL_DUCK_CATCH_RADIUS_PX,
        );
        if (!target) continue;

        eatenIds.add(target.id);
        dispatch({
          type: 'small-duck-catch',
          id: target.id,
          position: randomPositionAwayFrom(
            board,
            [
              duckCenter,
              ...current.feed
                .filter((item) => item.id !== target.id)
                .map((item) => itemCenter(item.position)),
              ...(current.bonusPickup
                ? [itemCenter(current.bonusPickup.position)]
                : []),
            ],
            FEED_ITEM_SIZE_PX,
          ),
          now,
          points: SMALL_DUCK_CATCH_POINTS,
        });
        dispatch({
          type: 'add-popup',
          popup: {
            id: crypto.randomUUID(),
            kind: 'catch',
            position: itemCenter(target.position),
            createdAt: now,
          },
        });
      }
    }, SMALL_DUCK_TICK_MS);

    return () => clearInterval(interval);
  }, [hasSmallDucks, isRoundLive]);

  const feedItems = useMemo(() => {
    const items: FeedItem[] = [...state.feed];
    if (state.bonusPickup) items.push(state.bonusPickup);
    items.push(...state.crumbs);
    return items;
  }, [state.feed, state.bonusPickup, state.crumbs]);

  return {
    status: state.status,
    score: state.score,
    comboCount: state.comboCount,
    comboExpiresAt: state.comboExpiresAt,
    comboWindowMs: DIFFICULTY_SETTINGS[difficulty].comboWindowMs,
    smallDucks: state.smallDucks,
    remainingMs: countdown.remainingMs,
    durationMs: durationMsRef.current,
    bonusPhaseEndsAt: state.bonusPhaseEndsAt,
    bonusPhaseDurationMs: BONUS_PHASE_DURATION_MS,
    feedItems,
    popups: state.popups,
    lastResult: state.lastResult,
    start,
    returnToMenu,
    handlePointerMove: evaluateProximity,
    handleItemActivate,
  };
}
