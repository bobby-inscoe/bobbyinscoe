import { Stack } from '@mantine/core';

import { ListingCard } from '@/features/house-scanner/components/listing-card';
import { ManualListingForm } from '@/features/house-scanner/components/manual-listing-form';
import type { ListingNotesController } from '@/features/house-scanner/hooks/use-listing-notes';
import type {
  Listing,
  Snapshot,
} from '@/features/house-scanner/types/contracts';
import type { HouseholdActions } from '@/features/house-scanner/types/household';
import { isListingStale } from '@/features/house-scanner/utils/listing-staleness';

interface AddLinkPanelProps
  extends Partial<Pick<HouseholdActions, 'onAddManual'>> {
  snapshot: Snapshot;
  userId: string;
  // The home the member already had when they pasted a link to it.
  duplicate: Listing | undefined;
  pending: string[];
  canSave: (listingId: string) => boolean;
  notes: ListingNotesController;
  onExisting: (listingId: string) => void;
  onCloseDuplicate: () => void;
  onFavorite: (listingId: string) => Promise<void>;
}

export function AddLinkPanel({
  snapshot,
  userId,
  duplicate,
  pending,
  canSave,
  notes,
  onAddManual,
  onExisting,
  onCloseDuplicate,
  onFavorite,
}: AddLinkPanelProps) {
  return (
    <Stack>
      <ManualListingForm
        snapshot={snapshot}
        onAdd={onAddManual}
        onExisting={onExisting}
      />
      {duplicate && (
        <ListingCard
          listing={duplicate}
          snapshot={snapshot}
          userId={userId}
          details
          stale={isListingStale(duplicate, snapshot.edition)}
          selected
          busy={pending.includes(duplicate.id)}
          canSave={canSave(duplicate.id)}
          notes={notes}
          onSelect={onCloseDuplicate}
          onFavorite={() => void onFavorite(duplicate.id)}
        />
      )}
    </Stack>
  );
}
