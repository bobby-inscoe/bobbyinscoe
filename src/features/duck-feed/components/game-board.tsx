import { Snail } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';

import { CatchPopup } from '@/features/duck-feed/components/catch-popup';
import { FeedItem } from '@/features/duck-feed/components/feed-item';
import { DuckIcon } from '@/features/duck-feed/components/icons/duck-icon';
import { SmallDuck } from '@/features/duck-feed/components/small-duck';
import type {
  Avatar,
  FeedItem as FeedItemModel,
  Popup,
  Position,
  SmallDuck as SmallDuckModel,
} from '@/features/duck-feed/types/game';
import { DUCK_COLOR, SNAIL_COLOR } from '@/features/duck-feed/utils/avatars';

interface GameBoardProps {
  ref: React.Ref<HTMLDivElement>;
  avatar: Avatar;
  feedItems: FeedItemModel[];
  smallDucks: SmallDuckModel[];
  popups: Popup[];
  isBonusPhase: boolean;
  onPointerMove: (position: Position) => void;
  onItemActivate: (id: string) => void;
}

export function GameBoard({
  ref,
  avatar,
  feedItems,
  smallDucks,
  popups,
  isBonusPhase,
  onPointerMove,
  onItemActivate,
}: GameBoardProps): React.JSX.Element {
  const [cursorPos, setCursorPos] = useState<Position | null>(null);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: this tracks cursor position for the game's proximity mechanic; every feed item is independently reachable and activatable via keyboard focus.
    <div
      ref={ref}
      className={`GameBoard GameBoard--custom-cursor${isBonusPhase ? ' GameBoard--bonus-phase' : ''}`}
      onMouseMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const position = {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        };
        onPointerMove(position);
        setCursorPos(position);
      }}
      onMouseLeave={() => setCursorPos(null)}
    >
      {feedItems.map((item) => (
        <FeedItem
          key={item.id}
          item={item}
          avatar={avatar}
          muted={isBonusPhase && item.kind === 'normal'}
          onActivate={onItemActivate}
        />
      ))}
      {smallDucks.map((duck) => (
        <SmallDuck key={duck.id} duck={duck} />
      ))}
      {popups.map((popup) => (
        <CatchPopup key={popup.id} popup={popup} />
      ))}
      {cursorPos && (
        <span
          className="CursorAvatar"
          style={{ left: cursorPos.x, top: cursorPos.y }}
        >
          {avatar === 'snail' ? (
            <Snail size={28} strokeWidth={1.75} color={SNAIL_COLOR} />
          ) : (
            <DuckIcon
              useOriginalArt
              size={28}
              strokeWidth={1.75}
              color={DUCK_COLOR}
            />
          )}
        </span>
      )}
    </div>
  );
}
