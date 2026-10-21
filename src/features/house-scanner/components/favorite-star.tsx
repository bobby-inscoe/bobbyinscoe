import { ActionIcon } from '@mantine/core';

import { classes } from '@/features/house-scanner/theme/shellter-theme';

interface FavoriteStarProps {
  // Whether the signed-in member has saved the home.
  mine: boolean;
  canSave: boolean;
  busy: boolean;
  onToggle: () => void;
}

/** The star over a home's photo. It saves or removes the member's own favorite only. */
export function FavoriteStar({
  mine,
  canSave,
  busy,
  onToggle,
}: FavoriteStarProps) {
  return (
    <ActionIcon
      className={classes.star}
      variant={mine ? 'filled' : 'default'}
      size="lg"
      radius="xl"
      aria-label={mine ? 'Remove my favorite' : 'Save favorite'}
      disabled={!canSave}
      loading={busy}
      onClick={onToggle}
    >
      {mine ? '★' : '☆'}
    </ActionIcon>
  );
}
