import { ActionIcon } from '@mantine/core';
import { Star } from 'lucide-react';
import { useIntl } from 'react-intl';
import { classes } from '@/features/house-scanner/theme/shellter-theme';

interface FavoriteStarProps {
  // Whether the signed-in member has saved the home.
  mine: boolean;
  // Whether another household member has saved it; shown pale so it reads apart from unsaved homes.
  others?: boolean;
  canSave: boolean;
  busy: boolean;
  onToggle: () => void;
}

/** The star over a home's photo. It saves or removes the member's own favorite only. */
export function FavoriteStar({
  mine,
  others,
  canSave,
  busy,
  onToggle,
}: FavoriteStarProps) {
  const intl = useIntl();

  return (
    <ActionIcon
      className={`${classes.star} ${others && !mine ? classes.savedByOthers : ''}`}
      variant={mine ? 'filled' : 'default'}
      size="lg"
      radius="xl"
      aria-label={
        mine
          ? intl.formatMessage({ id: 'listings.details.removeMyFavorite' })
          : intl.formatMessage({ id: 'listings.details.saveFavorite' })
      }
      disabled={!canSave}
      loading={busy}
      onClick={onToggle}
    >
      <Star size={20} fill={mine ? 'currentColor' : 'none'} aria-hidden />
    </ActionIcon>
  );
}
