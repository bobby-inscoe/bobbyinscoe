import { Flex, Paper, Stack, Text, Title } from '@mantine/core';
import { FormattedMessage } from 'react-intl';
import { CriteriaHelp } from '@/features/house-scanner/features/settings/features/criteria/components/criteria-help';
import { ProfileEditor } from '@/features/house-scanner/features/settings/features/criteria/components/profile-editor';
import type { SearchProfile } from '@/features/house-scanner/types/contracts';

export function CriteriaPanel({
  profiles,
  canEdit,
  synthetic,
  onSaveProfile,
}: {
  profiles: SearchProfile[];
  canEdit: boolean;
  synthetic: boolean;
  onSaveProfile?: (profile: SearchProfile) => Promise<void>;
}) {
  const header = (
    <>
      <Flex gap="sm" align="center" wrap="wrap">
        <Title order={2}>
          <FormattedMessage id="settings.criteria.householdProfile" />
        </Title>
        <CriteriaHelp />
      </Flex>
      {synthetic && (
        <Text size="sm" c="dimmed">
          <FormattedMessage id="settings.criteria.theseCriteriaAreFictionalEditsAffectThisDemoOnly" />
        </Text>
      )}
    </>
  );
  return (
    <>
      {profiles.length ? (
        profiles.map((profile) => (
          <ProfileEditor
            key={profile.id}
            header={header}
            profile={profile}
            canEdit={canEdit}
            onSave={onSaveProfile}
          />
        ))
      ) : (
        <Paper>
          <Stack>
            {header}
            <Text>
              <FormattedMessage id="settings.criteria.noSearchProfilesYet" />
            </Text>
          </Stack>
        </Paper>
      )}
    </>
  );
}
