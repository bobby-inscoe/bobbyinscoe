import { Button, Divider, Stack } from '@mantine/core';
import { LogOut } from 'lucide-react';
import { FormattedMessage } from 'react-intl';
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
  onSignOut?: () => void;
}

export function SettingsPanel({
  snapshot,
  userId,
  synthetic,
  onSaveProfile,
  access,
  onSignOut,
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
      {onSignOut && (
        <>
          <Divider />
          <Button
            variant="default"
            w="fit-content"
            leftSection={<LogOut size={16} aria-hidden />}
            onClick={onSignOut}
          >
            <FormattedMessage id="navigation.signOut" />
          </Button>
        </>
      )}
    </Stack>
  );
}
