import { Button, Paper, Stack, Text, Title } from '@mantine/core';
import { LogOut } from 'lucide-react';
import { FormattedMessage } from 'react-intl';
import { InstallShellter } from '@/features/house-scanner/components/install-shellter';
import { LanguageSelect } from '@/features/house-scanner/components/language-select';
import { ShellterHelp } from '@/features/house-scanner/features/settings/components/shellter-help';
import { CriteriaPanel } from '@/features/house-scanner/features/settings/features/criteria/components/criteria-panel';
import { FinancingEditor } from '@/features/house-scanner/features/settings/features/financing/components/financing-editor';
import { HouseholdAccessPanel } from '@/features/house-scanner/features/settings/features/household/components/household-access-panel';
import type { Snapshot } from '@/features/house-scanner/types/contracts';
import type {
  HouseholdAccessActions,
  HouseholdActions,
} from '@/features/house-scanner/types/household';
import { financingProfile } from '@/features/house-scanner/utils/housing-cost';

interface SettingsPanelProps
  extends Partial<Pick<HouseholdActions, 'onSaveProfile'>> {
  snapshot: Snapshot;
  userId: string;
  synthetic: boolean;
  onSignOut?: () => void;
  // Members and links, including simulated actions in the demo.
  access?: HouseholdAccessActions;
}

export function SettingsPanel({
  snapshot,
  userId,
  synthetic,
  onSaveProfile,
  onSignOut,
  access,
}: SettingsPanelProps) {
  const member = snapshot.members.find((entry) => entry.userId === userId);
  const profile = financingProfile(snapshot.profiles);
  return (
    <Stack w="100%" maw="48rem">
      <ShellterHelp />
      <CriteriaPanel
        profiles={snapshot.profiles}
        canEdit={member?.role === 'owner'}
        synthetic={synthetic}
        onSaveProfile={onSaveProfile}
      />
      {profile && (
        <FinancingEditor
          profile={profile}
          canEdit={member?.role === 'owner'}
          onSave={onSaveProfile}
        />
      )}
      {access && <HouseholdAccessPanel access={access} userId={userId} />}
      <Paper>
        <Stack>
          <Title order={2}>
            <FormattedMessage id="settings.personal.heading" />
          </Title>
          <Text size="sm" c="dimmed">
            <FormattedMessage id="settings.personal.languageDescription" />
          </Text>
          <LanguageSelect label />
          <InstallShellter />
          {onSignOut && (
            <Button
              variant="default"
              w="50%"
              leftSection={<LogOut size={16} aria-hidden />}
              onClick={onSignOut}
            >
              <FormattedMessage id="navigation.signOut" />
            </Button>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
