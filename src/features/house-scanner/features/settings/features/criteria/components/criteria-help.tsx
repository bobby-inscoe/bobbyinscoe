import { Button, Modal, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { FormattedMessage, type IntlShape, useIntl } from 'react-intl';

const ABOUT = (intl: IntlShape) => [
  intl.formatMessage({
    id: 'settings.criteria.shellterFollowsApartmentsForSaleInGoteborg',
  }),
  intl.formatMessage({
    id: 'settings.criteria.householdProfileHelp',
  }),
  intl.formatMessage({ id: 'settings.criteria.budgetHelp' }),
  intl.formatMessage({ id: 'settings.criteria.locationHelp' }),
  intl.formatMessage({
    id: 'settings.criteria.filtersOnTheListingsTabAreYoursAloneAnd',
  }),
];

/** A button that opens a short explanation of what Shellter is and how the settings are used. */
export function CriteriaHelp() {
  const intl = useIntl();

  const [opened, setOpened] = useState(false);
  return (
    <>
      <Button
        variant="default"
        size="xs"
        aria-haspopup="dialog"
        onClick={() => setOpened(true)}
      >
        <FormattedMessage id="settings.criteria.howDoesThisWork" />
      </Button>
      <Modal
        opened={opened}
        onClose={() => setOpened(false)}
        title={intl.formatMessage({ id: 'settings.criteria.aboutShellter' })}
        size="md"
        closeButtonProps={{
          'aria-label': intl.formatMessage({ id: 'common.close' }),
        }}
      >
        <Stack gap="xs">
          {ABOUT(intl).map((line) => (
            <Text key={line} size="sm">
              {line}
            </Text>
          ))}
        </Stack>
      </Modal>
    </>
  );
}
