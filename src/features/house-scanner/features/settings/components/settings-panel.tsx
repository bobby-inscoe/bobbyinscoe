import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { FormattedMessage } from 'react-intl';
import { LanguageSelect } from '@/features/house-scanner/components/language-select';
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
  onSignOut?: () => void;
  // Members and links; absent in the demo.
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
  return (
    <Stack w="100%" maw="48rem">
      <CriteriaPanel
        profiles={snapshot.profiles}
        canEdit={member?.role === 'owner'}
        synthetic={synthetic}
        onSaveProfile={onSaveProfile}
      />
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
        </Stack>
      </Paper>
      {onSignOut && (
        <Group>
          <Button variant="default" onClick={onSignOut}>
            <FormattedMessage id="navigation.signOut" />
          </Button>
        </Group>
      )}
    </Stack>
  );
}
