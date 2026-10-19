import type { Avatar } from '@/features/duck-feed/types/game';

export const AVATARS: Avatar[] = ['duck', 'snail'];

export const AVATAR_LABELS: Record<Avatar, string> = {
  duck: 'Duck',
  snail: 'Snail',
};

// A warm caramel shell (reusing the existing combo/high-score gold accent)
// against a cool, teal-leaning leaf green: an intentional warm/cool pairing
// rather than one color reused on both, and each still reads as its subject.
export const SNAIL_COLOR = '#f4c96b';
export const LEAF_COLOR = '#34d399';

// Mirrors the snail/leaf warm-cool pairing so both avatars read as a
// cohesive icon set: a warm duck body against a cool golden wheat head.
export const DUCK_COLOR = '#fbbf24';
export const WHEAT_COLOR = '#d97706';
