import type {
  LoadNotes,
  SaveNote,
} from '@/features/house-scanner/hooks/use-listing-notes';
import type {
  ManualSubmission,
  SearchProfile,
  Snapshot,
} from '@/features/house-scanner/types/contracts';

/** What the signed-in session and the demo both hand the workspace. */
export interface HouseholdActions {
  onSaveFavorite: (listingId: string) => Promise<void>;
  onSaveFavorites: (listingIds: string[]) => Promise<void>;
  onRemoveFavorite: (listingId: string) => Promise<void>;
  onAddManual: (submission: ManualSubmission) => Promise<void>;
  onSaveProfile: (profile: SearchProfile) => Promise<void>;
  // Hides or unhides homes for the signed-in member only.
  onSetHidden: (listingIds: string[], hidden: boolean) => Promise<void>;
  onLoadNotes: LoadNotes;
  onSaveNote: SaveNote;
}

export interface Household extends HouseholdActions {
  snapshot: Snapshot;
  userId: string;
}

export type WorkspaceTab =
  | 'suggestions'
  | 'favorites'
  | 'viewings'
  | 'manual'
  | 'sources'
  | 'settings';
