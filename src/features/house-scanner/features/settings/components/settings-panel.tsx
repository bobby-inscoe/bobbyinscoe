import { Stack } from '@mantine/core';
import { CriteriaPanel } from '@/features/house-scanner/features/settings/features/criteria/components/criteria-panel';
import { HouseholdAccessPanel } from '@/features/house-scanner/features/settings/features/household/components/household-access-panel';
import type { Snapshot } from '@/features/house-scanner/types/contracts';
import type {
  HouseholdAccessActions,
  HouseholdActions,
} from '@/features/house-scanner/types/household';

interface SettingsPanelProps
  extends Partial<Pick<HouseholdActions, 'onSaveProfile'>> {
  snapshot: Snapshot;
  userId: string;
  synthetic: boolean;
  // Members and links; absent in the demo.
  access?: HouseholdAccessActions;
}

export function SettingsPanel({
  snapshot,
  userId,
  synthetic,
  onSaveProfile,
  access,
}: SettingsPanelProps) {
  const member = snapshot.members.find((entry) => entry.userId === userId);
  return (
    <Stack w="100%" maw="48rem">
      <CriteriaPanel
        profiles={snapshot.profiles}
        canEdit={member?.role === 'owner'}
        synthetic={synthetic}
        onSaveProfile={onSaveProfile}
      />
      {access && <HouseholdAccessPanel access={access} userId={userId} />}
    </Stack>
  );
}
