import type { BoardSize, Position } from '@/features/duck-feed/types/game';
import { FEED_ITEM_SIZE_PX } from '@/features/duck-feed/utils/constants';

export function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function itemCenter(
  position: Position,
  itemSize: number = FEED_ITEM_SIZE_PX,
): Position {
  return { x: position.x + itemSize / 2, y: position.y + itemSize / 2 };
}

function playableBounds(board: BoardSize, itemSize: number): BoardSize {
  return {
    width: Math.max(board.width - itemSize, 0),
    height: Math.max(board.height - itemSize, 0),
  };
}

export function randomPosition(
  board: BoardSize,
  itemSize: number = FEED_ITEM_SIZE_PX,
): Position {
  const bounds = playableBounds(board, itemSize);
  return {
    x: Math.random() * bounds.width,
    y: Math.random() * bounds.height,
  };
}

const MAX_PLACEMENT_ATTEMPTS = 8;

/** Picks a random in-bounds position whose center is at least `minDistance` from `avoid`. */
export function randomPositionAwayFrom(
  board: BoardSize,
  avoid: Position | Position[],
  minDistance: number,
  itemSize: number = FEED_ITEM_SIZE_PX,
): Position {
  const points = Array.isArray(avoid) ? avoid : [avoid];
  const clearance = (position: Position) =>
    Math.min(
      ...points.map((point) => distance(itemCenter(position, itemSize), point)),
    );
  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
    const candidate = randomPosition(board, itemSize);
    if (clearance(candidate) >= minDistance) {
      return candidate;
    }
  }

  const bounds = playableBounds(board, itemSize);
  const corners: Position[] = [
    { x: 0, y: 0 },
    { x: bounds.width, y: 0 },
    { x: 0, y: bounds.height },
    { x: bounds.width, y: bounds.height },
  ];
  return corners.reduce((farthest, corner) =>
    clearance(corner) > clearance(farthest) ? corner : farthest,
  );
}
