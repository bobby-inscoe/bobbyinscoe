import { Stack, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { FormattedMessage } from 'react-intl';

export function InstallShellter() {
  const standalone = useMediaQuery(
    '(display-mode: standalone), (display-mode: fullscreen)',
  );
  if (
    standalone ||
    ('standalone' in navigator && navigator.standalone === true)
  )
    return null;
  return (
    <Stack gap="xs">
      <Title order={3} size="h5">
        <FormattedMessage id="settings.personal.installHeading" />
      </Title>
      <Text size="sm">
        <FormattedMessage id="settings.personal.installDescription" />
      </Text>
      <Text size="sm">
        <FormattedMessage id="settings.personal.installIphone" />
      </Text>
      <Text size="sm">
        <FormattedMessage id="settings.personal.installAndroid" />
      </Text>
    </Stack>
  );
}
