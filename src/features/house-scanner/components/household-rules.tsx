import { Stack, Text } from '@mantine/core';
import { FormattedMessage } from 'react-intl';

const rules = [
  ['access.rulesSharedLabel', 'access.rulesShared'],
  ['access.rulesPersonalLabel', 'access.rulesPersonal'],
] as const;

// What a household shares and what stays personal. The invitation page and the help dialog both show this one list.
export function HouseholdRules() {
  return (
    <Stack gap={4}>
      {rules.map(([label, text]) => (
        <Text key={label} size="sm">
          <Text span fw={700} inherit>
            <FormattedMessage id={label} />:
          </Text>{' '}
          <FormattedMessage id={text} />
        </Text>
      ))}
    </Stack>
  );
}
