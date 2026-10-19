import { UnstyledButton } from '@mantine/core';
import { Leaf } from 'lucide-react';
import type React from 'react';

import { WheatIcon } from '@/features/duck-feed/components/icons/wheat-icon';
import type {
  Avatar,
  FeedItem as FeedItemModel,
} from '@/features/duck-feed/types/game';
import { LEAF_COLOR, WHEAT_COLOR } from '@/features/duck-feed/utils/avatars';
import { FEED_ITEM_SIZE_PX } from '@/features/duck-feed/utils/constants';

interface FeedItemProps {
  item: FeedItemModel;
  avatar: Avatar;
  muted: boolean;
  onActivate: (id: string) => void;
}

function ariaLabel(kind: FeedItemModel['kind'], avatar: Avatar): string {
  switch (kind) {
    case 'normal':
      return avatar === 'duck' ? 'Feed the duck' : 'Feed the snail';
    case 'bonus-pickup':
      return 'Grab the bonus item';
    case 'fan-pickup':
      return 'Grab the duck flock item';
    case 'crumb':
      return 'Grab the crumb';
  }
}

export function FeedItem({
  item,
  avatar,
  muted,
  onActivate,
}: FeedItemProps): React.JSX.Element {
  return (
    <UnstyledButton
      type="button"
      aria-label={ariaLabel(item.kind, avatar)}
      tabIndex={muted ? -1 : 0}
      className={`FeedItem FeedItem--icon FeedItem--${item.kind}${item.kind === 'crumb' ? '' : ' shake'}${muted ? ' FeedItem--muted' : ''}`}
      style={{
        left: item.position.x,
        top: item.position.y,
        width: FEED_ITEM_SIZE_PX,
        height: FEED_ITEM_SIZE_PX,
      }}
      onFocus={() => onActivate(item.id)}
    >
      {avatar === 'snail' ? (
        <Leaf size={32} strokeWidth={1.75} color={LEAF_COLOR} />
      ) : (
        <WheatIcon size={32} strokeWidth={1.75} color={WHEAT_COLOR} />
      )}
    </UnstyledButton>
  );
}
