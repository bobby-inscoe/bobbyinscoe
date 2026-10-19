import { ActionIcon } from '@mantine/core';

import styles from '@/features/house-scanner/components/household-workspace.module.css';

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
      className={styles.star}
      variant={mine ? 'filled' : 'default'}
      color="moss"
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
