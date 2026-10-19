import type {
  BoardSize,
  Position,
  SmallDuck,
} from '@/features/duck-feed/types/game';
import {
  SMALL_DUCK_COUNT,
  SMALL_DUCK_MAX_BOUNCES,
  SMALL_DUCK_SIZE_PX,
  SMALL_DUCK_SPEED_PX_PER_S,
} from '@/features/duck-feed/utils/scoring';

/** Fans ducks out from `origin` (a center point) at even angles, with a random starting rotation. */
export function spawnSmallDuckFan(origin: Position): SmallDuck[] {
  const step = (Math.PI * 2) / SMALL_DUCK_COUNT;
  const phase = Math.random() * step;
  return Array.from({ length: SMALL_DUCK_COUNT }, (_, index) => {
    const angle = phase + index * step;
    return {
      id: crypto.randomUUID(),
      position: {
        x: origin.x - SMALL_DUCK_SIZE_PX / 2,
        y: origin.y - SMALL_DUCK_SIZE_PX / 2,
      },
      velocity: {
        x: Math.cos(angle) * SMALL_DUCK_SPEED_PX_PER_S,
        y: Math.sin(angle) * SMALL_DUCK_SPEED_PX_PER_S,
      },
      bouncesLeft: SMALL_DUCK_MAX_BOUNCES,
    };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Advances a duck by `dtMs`. Reflects off a wall while it has bounces left
 * (a corner hit spends one), then lets it leave the board. Returns null once
 * it is fully off the board.
 */
export function stepSmallDuck(
  duck: SmallDuck,
  dtMs: number,
  board: BoardSize,
): SmallDuck | null {
  const seconds = dtMs / 1000;
  const maxX = Math.max(board.width - SMALL_DUCK_SIZE_PX, 0);
  const maxY = Math.max(board.height - SMALL_DUCK_SIZE_PX, 0);

  let x = duck.position.x + duck.velocity.x * seconds;
  let y = duck.position.y + duck.velocity.y * seconds;
  let { x: vx, y: vy } = duck.velocity;
  let bouncesLeft = duck.bouncesLeft;

  const hitsSide = x < 0 || x > maxX;
  const hitsEnd = y < 0 || y > maxY;

  if ((hitsSide || hitsEnd) && bouncesLeft > 0) {
    if (hitsSide) {
      vx = -vx;
      x = clamp(x < 0 ? -x : 2 * maxX - x, 0, maxX);
    }
    if (hitsEnd) {
      vy = -vy;
      y = clamp(y < 0 ? -y : 2 * maxY - y, 0, maxY);
    }
    bouncesLeft -= 1;
  } else if (
    x < -SMALL_DUCK_SIZE_PX ||
    x > board.width ||
    y < -SMALL_DUCK_SIZE_PX ||
    y > board.height
  ) {
    return null;
  }

  return {
    ...duck,
    position: { x, y },
    velocity: { x: vx, y: vy },
    bouncesLeft,
  };
}
