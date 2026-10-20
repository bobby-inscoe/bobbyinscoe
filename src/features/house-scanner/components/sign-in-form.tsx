import { Button, Checkbox, Stack, Text, TextInput } from '@mantine/core';
import { type ReactNode, useState } from 'react';

interface SignInFormProps {
  title: ReactNode;
  onSignIn: (
    email: string,
    password: string,
    remember: boolean,
  ) => Promise<void>;
  onResetPassword: (email: string) => Promise<void>;
  children?: ReactNode;
}

// Email and password sign-in, with a way to ask for a reset link that never says whether the address has an account.
export function SignInForm({
  title,
  onSignIn,
  onResetPassword,
  children,
}: SignInFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
  async function perform(action: () => Promise<string | undefined>) {
    setBusy(true);
    setMessage(undefined);
    try {
      const done = await action();
      if (done) setMessage({ text: done, error: false });
    } catch (error) {
      setMessage({
        text:
          error instanceof Error ? error.message : 'Request failed. Try again.',
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void perform(async () => {
          if (resetting) {
            await onResetPassword(email);
            return 'If an account uses that address, an email with a reset link is on its way.';
          }
          await onSignIn(email, password, remember);
          setPassword('');
          return undefined;
        });
      }}
    >
      <Stack align="flex-start" gap="md">
        {title}
        <TextInput
          label="Email"
          type="email"
          w="100%"
          maw="22rem"
          autoComplete="username"
          autoCapitalize="none"
          required
          value={email}
          disabled={busy}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        {!resetting && (
          <>
            <TextInput
              label="Password"
              w="100%"
              maw="22rem"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              disabled={busy}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            <Checkbox
              label="Remember this device"
              description="Leave off on shared devices."
              checked={remember}
              disabled={busy}
              onChange={(event) => setRemember(event.currentTarget.checked)}
            />
          </>
        )}
        {message && (
          <Text size="sm" role={message.error ? 'alert' : 'status'}>
            {message.text}
          </Text>
        )}
        <Button type="submit" loading={busy}>
          {resetting ? 'Send reset link' : 'Sign in'}
        </Button>
        <Button
          type="button"
          variant="subtle"
          disabled={busy}
          onClick={() => {
            setResetting(!resetting);
            setMessage(undefined);
          }}
        >
          {resetting ? 'Back to sign in' : 'Forgot password?'}
        </Button>
        {children}
      </Stack>
    </form>
  );
}
