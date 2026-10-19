import { HouseholdWorkspace } from '@/features/house-scanner/components/household-workspace';
import { useDemoHousehold } from '@/features/house-scanner/hooks/use-demo-household';
import { DEMO_USER_ID } from '@/features/house-scanner/mock/synthetic-household';

export function SyntheticWorkspace() {
  const demo = useDemoHousehold();
  return (
    <HouseholdWorkspace
      snapshot={demo.snapshot}
      userId={DEMO_USER_ID}
      onSaveFavorite={demo.saveFavorite}
      onSaveFavorites={demo.saveFavorites}
      onRemoveFavorite={demo.removeFavorite}
      onAddManual={demo.addManual}
      onSaveProfile={demo.saveProfile}
      onSetHidden={demo.setHidden}
      onLoadNotes={demo.loadNotes}
      onSaveNote={demo.saveNote}
    />
  );
}
