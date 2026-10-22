import { Flex, Stack, Text, Title } from '@mantine/core';
import { FormattedMessage } from 'react-intl';
import { CriteriaHelp } from '@/features/house-scanner/components/criteria-help';
import { HouseholdAccessPanel } from '@/features/house-scanner/components/household-access-panel';
import { ProfileEditor } from '@/features/house-scanner/components/profile-editor';
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
      <Flex gap="sm" align="center" wrap="wrap">
        <Title order={2}>
          <FormattedMessage id="settings.criteria.defaultFilter" />
        </Title>
        <CriteriaHelp />
      </Flex>
      {synthetic && (
        <Text size="sm" c="dimmed">
          <FormattedMessage id="settings.criteria.theseCriteriaAreFictionalEditsAffectThisDemoOnly" />
        </Text>
      )}
      {snapshot.profiles.length ? (
        snapshot.profiles.map((profile) => (
          <ProfileEditor
            key={profile.id}
            profile={profile}
            canEdit={member?.role === 'owner'}
            onSave={onSaveProfile}
          />
        ))
      ) : (
        <Text>
          <FormattedMessage id="settings.criteria.noSearchProfilesYet" />
        </Text>
      )}
      {access && <HouseholdAccessPanel access={access} userId={userId} />}
    </Stack>
  );
}
