import { Flex, Stack, Text, Title } from '@mantine/core';

import { CriteriaHelp } from '@/features/house-scanner/components/criteria-help';
import { ProfileEditor } from '@/features/house-scanner/components/profile-editor';
import type { Snapshot } from '@/features/house-scanner/types/contracts';
import type { HouseholdActions } from '@/features/house-scanner/types/household';

interface SettingsPanelProps
  extends Partial<Pick<HouseholdActions, 'onSaveProfile'>> {
  snapshot: Snapshot;
  userId: string;
  synthetic: boolean;
}

export function SettingsPanel({
  snapshot,
  userId,
  synthetic,
  onSaveProfile,
}: SettingsPanelProps) {
  const member = snapshot.members.find((entry) => entry.userId === userId);
  return (
    <Stack maw="48rem">
      <Flex gap="sm" justify="space-between" align="center" wrap="wrap">
        <Title order={2}>Search criteria</Title>
        <CriteriaHelp />
      </Flex>
      {synthetic && (
        <Text size="sm" c="dimmed">
          These criteria are fictional. Edits affect this demo only.
        </Text>
      )}
      {snapshot.profiles.length ? (
        snapshot.profiles.map((profile) => (
          <ProfileEditor
            key={`${profile.id}:${profile.revision}`}
            profile={profile}
            canEdit={member?.role === 'owner'}
            onSave={onSaveProfile}
          />
        ))
      ) : (
        <Text>No search profiles yet.</Text>
      )}
    </Stack>
  );
}
