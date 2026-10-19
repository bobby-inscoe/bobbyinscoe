export type GameStatus = 'idle' | 'playing' | 'bonus-phase' | 'game-over';

export type Difficulty = 'easy' | 'normal' | 'hard';

export type Avatar = 'duck' | 'snail';

export interface Position {
  x: number;
  y: number;
}

export interface BoardSize {
  width: number;
  height: number;
}

export type FeedItemKind = 'normal' | 'bonus-pickup' | 'fan-pickup' | 'crumb';

export interface FeedItem {
  id: string;
  kind: FeedItemKind;
  position: Position;
  lastMovedAt: number;
}

/** A small duck released by a fan pickup; `position` is its top-left, like a feed item's. */
export interface SmallDuck {
  id: string;
  position: Position;
  /** Pixels per second. */
  velocity: Position;
  /** Wall ricochets left; once spent it flies off the board instead of bouncing. */
  bouncesLeft: number;
}

export interface HighScoreEntry {
  name: string;
  score: number;
}

export interface RoundResult {
  score: number;
  bestCombo: number;
  bonusTimeGainedMs: number;
  isNewHighScore: boolean;
}

export type PopupKind = 'catch' | 'time-bonus';

export interface Popup {
  id: string;
  kind: PopupKind;
  position: Position;
  createdAt: number;
}
