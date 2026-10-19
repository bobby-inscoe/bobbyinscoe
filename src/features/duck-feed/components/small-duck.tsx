import type React from 'react';

import { DuckIcon } from '@/features/duck-feed/components/icons/duck-icon';
import type { SmallDuck as SmallDuckModel } from '@/features/duck-feed/types/game';
import { SMALL_DUCK_SIZE_PX } from '@/features/duck-feed/utils/scoring';

interface SmallDuckProps {
  duck: SmallDuckModel;
}

/** Decorative and non-interactive: ducks fly on their own, so there is nothing to focus or press. */
export function SmallDuck({ duck }: SmallDuckProps): React.JSX.Element {
  return (
    <span
      className="SmallDuck"
      aria-hidden="true"
      style={{
        left: duck.position.x,
        top: duck.position.y,
        width: SMALL_DUCK_SIZE_PX,
        height: SMALL_DUCK_SIZE_PX,
      }}
    >
      <DuckIcon useOriginalArt size={SMALL_DUCK_SIZE_PX} />
    </span>
  );
}
