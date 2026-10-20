import { Button, Stack, Text, TextInput, Title } from '@mantine/core';
import { useState } from 'react';

// Shown after an invitation or reset email signs the person in, before anything else.
export function SetPasswordForm({
  kind,
  onSave,
}: {
  kind: 'invite' | 'recovery';
  onSave: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (password !== repeat) {
          setError('The two passwords differ.');
          return;
        }
        setBusy(true);
        setError('');
        onSave(password)
          .catch((failure: unknown) =>
            setError(
              failure instanceof Error
                ? failure.message
                : 'The password could not be saved.',
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      <Stack align="flex-start" gap="md">
        <Title order={2}>
          {kind === 'invite' ? 'Choose your password' : 'Choose a new password'}
        </Title>
        <Text size="sm">
          Use 8 to 72 characters. You sign in with your email and this password.
        </Text>
        <TextInput
          label="New password"
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
          label="Repeat the password"
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
            {error}
          </Text>
        )}
        <Button type="submit" loading={busy}>
          Save password
        </Button>
      </Stack>
    </form>
  );
}
