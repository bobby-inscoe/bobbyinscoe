import { Button, Modal, Stack, Text } from '@mantine/core';
import { HelpCircle } from 'lucide-react';
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { HouseholdRules } from '@/features/house-scanner/components/household-rules';

/** The first control in Settings: a short explanation of Shellter and the household, with the invitation page's list. */
export function ShellterHelp() {
  const intl = useIntl();
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Button
        variant="default"
        leftSection={<HelpCircle size={16} aria-hidden />}
        aria-haspopup="dialog"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => setOpened(true)}
      >
        <FormattedMessage id="settings.help.title" />
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={intl.formatMessage({ id: 'settings.help.title' })}
        size="md"
        closeButtonProps={{
          'aria-label': intl.formatMessage({ id: 'common.close' }),
        }}
      >
        <Stack gap="sm">
          <Text size="sm">
            <FormattedMessage id="settings.help.follows" />
          </Text>
          <Text size="sm">
            <FormattedMessage id="settings.help.household" />
          </Text>
          <HouseholdRules />
          <Text size="sm">
            <FormattedMessage id="settings.help.roles" />
          </Text>
          <Text size="sm">
            <FormattedMessage id="settings.help.criteriaAndFilters" />
          </Text>
        </Stack>
      </Modal>
    </>
  );
}
