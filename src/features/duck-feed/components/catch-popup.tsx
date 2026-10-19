import type React from 'react';

import type { Popup } from '@/features/duck-feed/types/game';
import { CRUMB_TIME_BONUS_MS } from '@/features/duck-feed/utils/scoring';

const timeBonusLabel = `+${(CRUMB_TIME_BONUS_MS / 1000).toFixed(1)}s!`;

const LABEL_BY_KIND: Record<Popup['kind'], string> = {
  catch: '❤',
  'time-bonus': timeBonusLabel,
};

interface CatchPopupProps {
  popup: Popup;
}

export function CatchPopup({ popup }: CatchPopupProps): React.JSX.Element {
  return (
    <span
      className={`CatchPopup CatchPopup--${popup.kind}`}
      style={{ left: popup.position.x, top: popup.position.y }}
    >
      {LABEL_BY_KIND[popup.kind]}
    </span>
  );
}
