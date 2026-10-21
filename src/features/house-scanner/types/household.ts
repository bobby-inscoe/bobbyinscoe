import type { HouseholdAccess } from '@/features/house-scanner/api/household-client';
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
  // Hides or unhides homes for the whole household.
  onSetHidden: (listingIds: string[], hidden: boolean) => Promise<void>;
  onLoadNotes: LoadNotes;
  onSaveNote: SaveNote;
}

/** Household settings actions; only a signed-in session has them, never the demo. */
export interface HouseholdAccessActions {
  load: () => Promise<HouseholdAccess>;
  /** Makes a fresh link for an address, replacing its older one. Sends nothing; returns the link. */
  createLink: (purpose: 'create' | 'join', email?: string) => Promise<string>;
  /** Makes a link for an address and emails it. Returns the link so it can be copied too. */
  sendLink: (purpose: 'create' | 'join', email: string) => Promise<string>;
  revoke: (invitationId: string) => Promise<void>;
  rename: (name: string) => Promise<void>;
  makeOwner: (userId: string) => Promise<void>;
  deactivate: (userId: string) => Promise<void>;
  leave: () => Promise<void>;
}

export interface Household extends HouseholdActions {
  snapshot: Snapshot;
  userId: string;
  access?: HouseholdAccessActions;
}

export type WorkspaceTab =
  | 'suggestions'
  | 'favorites'
  | 'viewings'
  | 'manual'
  | 'settings';
