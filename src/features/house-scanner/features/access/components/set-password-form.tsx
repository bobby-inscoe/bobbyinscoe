import { Button, Stack, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import {
  errorFeedback,
  type Feedback,
  formatFeedback,
} from '@/features/house-scanner/i18n/catalogs';

// Shown after an invitation or reset email signs the person in, before anything else.
export function SetPasswordForm({
  kind,
  onSave,
}: {
  kind: 'invite' | 'recovery';
  onSave: (password: string) => Promise<void>;
}) {
  const intl = useIntl();

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Feedback>('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (password !== repeat) {
          setError('access.theTwoPasswordsDiffer');
          return;
        }
        setBusy(true);
        setError('');
        onSave(password)
          .catch((failure: unknown) => setError(errorFeedback(failure)))
          .finally(() => setBusy(false));
      }}
      noValidate
    >
      <Stack align="flex-start" gap="md">
        <Title order={2}>
          {kind === 'invite'
            ? intl.formatMessage({ id: 'access.chooseYourPassword' })
            : intl.formatMessage({ id: 'access.chooseANewPassword' })}
        </Title>
        <Text size="sm">
          <FormattedMessage id="access.use8To72CharactersYouSignInWith" />
        </Text>
        <TextInput
          label={intl.formatMessage({ id: 'access.newPassword' })}
          type="password"
          autoComplete="new-password"
          w="100%"
          maw="22rem"
          required
          value={password}
          disabled={busy}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        <TextInput
          label={intl.formatMessage({ id: 'access.repeatThePassword' })}
          type="password"
          autoComplete="new-password"
          w="100%"
          maw="22rem"
          required
          value={repeat}
          disabled={busy}
          onChange={(event) => setRepeat(event.currentTarget.value)}
        />
        {error && (
          <Text size="sm" role="alert">
            {formatFeedback(intl, error)}
          </Text>
        )}
        <Button type="submit" loading={busy}>
          <FormattedMessage id="access.savePassword" />
        </Button>
      </Stack>
    </form>
  );
}
