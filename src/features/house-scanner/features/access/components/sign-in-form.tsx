import {
  Anchor,
  Button,
  Checkbox,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { type ReactNode, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  errorFeedback,
  type Feedback,
  formatFeedback,
} from '@/features/house-scanner/i18n/catalogs';

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
  const intl = useIntl();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: Feedback; error: boolean }>();
  async function perform(action: () => Promise<Feedback | undefined>) {
    setBusy(true);
    setMessage(undefined);
    try {
      const done = await action();
      if (done) setMessage({ text: done, error: false });
    } catch (error) {
      setMessage({
        text: errorFeedback(error),
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
            return 'access.ifAnAccountUsesThatAddressAnEmailWith';
          }
          await onSignIn(email, password, remember);
          setPassword('');
          return undefined;
        });
      }}
      noValidate
    >
      <Stack align="flex-start" gap="md">
        {title}
        <TextInput
          label={intl.formatMessage({ id: 'access.email' })}
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
              label={intl.formatMessage({ id: 'access.password' })}
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
              label={intl.formatMessage({ id: 'access.rememberThisDevice' })}
              description={intl.formatMessage({
                id: 'access.leaveOffOnSharedDevices',
              })}
              checked={remember}
              disabled={busy}
              onChange={(event) => setRemember(event.currentTarget.checked)}
            />
          </>
        )}
        {message && (
          <Text size="sm" role={message.error ? 'alert' : 'status'}>
            {formatFeedback(intl, message.text)}
          </Text>
        )}
        <Button type="submit" loading={busy}>
          {resetting
            ? intl.formatMessage({ id: 'access.sendResetLink' })
            : intl.formatMessage({ id: 'access.signIn' })}
        </Button>
        <Anchor
          component="button"
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => {
            setResetting(!resetting);
            setMessage(undefined);
          }}
        >
          {resetting
            ? intl.formatMessage({ id: 'access.backToSignIn' })
            : intl.formatMessage({ id: 'access.forgotPassword' })}
        </Anchor>
        {children}
      </Stack>
    </form>
  );
}
