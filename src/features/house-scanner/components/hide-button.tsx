import { ActionIcon } from '@mantine/core';

import styles from '@/features/house-scanner/components/household-workspace.module.css';

// Lucide's "eye-off": an eye with a slash through it.
function EyeOffIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

interface HideButtonProps {
  listingId: string;
  hidden: boolean;
  // Takes the id so a list can share one handler, which keeps memoized cards from re-rendering.
  onToggle: (listingId: string) => void;
}

// Sits over the photo beside the star and lights up in the same green while the home is hidden.
// Hiding is personal and only changes this member's view; it never touches favorites or notes.
export function HideButton({ listingId, hidden, onToggle }: HideButtonProps) {
  return (
    <ActionIcon
      className={styles.hide}
      variant={hidden ? 'filled' : 'default'}
      color="moss"
      size="lg"
      radius="xl"
      aria-label={hidden ? 'Unhide this home' : 'Hide this home'}
      title={hidden ? 'Unhide this home' : 'Hide this home'}
      onClick={() => onToggle(listingId)}
    >
      <EyeOffIcon />
    </ActionIcon>
  );
}
