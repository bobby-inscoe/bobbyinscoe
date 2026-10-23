import {
  Alert,
  Anchor,
  Button,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type { InvitationPreview } from '@/features/house-scanner/api/household-client';
import { HouseholdRules } from '@/features/house-scanner/components/household-rules';
import {
  errorFeedback,
  type Feedback,
  formatFeedback,
  messageValue,
} from '@/features/house-scanner/i18n/catalogs';
import { formatDate } from '@/features/house-scanner/utils/format';

interface InvitePanelProps {
  token: string;
  signedIn: boolean;
  onPreview: (token: string) => Promise<InvitationPreview>;
  onCreateAccount: (
    token: string,
    email: string,
    password: string,
  ) => Promise<void>;
  onAccept: (
    token: string,
    householdName: string | null,
    displayName: string,
  ) => Promise<void>;
  // The sign-in form for someone who already has an account.
  signIn: ReactNode;
}

// What an invitation link grants, and the one way through it: a new person creates an account with their email and a
// password, or switches to signing in, and a signed-in person names the household or themselves and accepts.
export function InvitePanel({
  token,
  signedIn,
  onPreview,
  onCreateAccount,
  onAccept,
  signIn,
}: InvitePanelProps) {
  const intl = useIntl();

  const [preview, setPreview] = useState<InvitationPreview | 'loading'>(
    'loading',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: Feedback; error: boolean }>();
  // The session hands out a new function on every render; the preview is fetched once per token.
  const preview$ = useRef(onPreview);
  preview$.current = onPreview;
  useEffect(() => {
    let current = true;
    preview$
      .current(token)
      .then((value) => current && setPreview(value))
      .catch(() => current && setPreview({ valid: false }));
    return () => {
      current = false;
    };
  }, [token]);
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
  if (preview === 'loading')
    return (
      <Text role="status">
        <FormattedMessage id="access.checkingTheInvitation" />
      </Text>
    );
  if (!preview.valid)
    return (
      <Stack align="flex-start">
        <Title order={2}>
          <FormattedMessage id="access.thisInvitationCannotBeUsed" />
        </Title>
        <Text>
          <FormattedMessage id="access.itHasExpiredBeenUsedOrBeenRevokedAsk" />
        </Text>
      </Stack>
    );
  const create = preview.purpose === 'create';
  const from =
    preview.issuerName ?? intl.formatMessage({ id: 'access.aShellterMember' });
  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Title order={2}>
          {create
            ? intl.formatMessage({ id: 'access.createYourOwnHousehold' })
            : intl.formatMessage(
                { id: 'access.join' },
                {
                  value0: messageValue(
                    preview.householdName ??
                      intl.formatMessage({ id: 'access.aHousehold' }),
                  ),
                },
              )}
        </Title>
        <Text>
          <FormattedMessage
            id="access.theLinkWorksUntil"
            values={{
              value0: messageValue(
                create
                  ? intl.formatMessage(
                      {
                        id: 'access.invitedYouToStartYourOwnShellterHouseholdIt',
                      },
                      { value0: messageValue(from) },
                    )
                  : intl.formatMessage(
                      {
                        id: 'access.invitedYouToJoinTheirHouseholdAndShareIts',
                      },
                      { value0: messageValue(from) },
                    ),
              ),
              value1: messageValue(formatDate(preview.expiresAt, intl)),
            }}
          />
        </Text>
        <HouseholdRules />
      </Stack>
      {message && (
        <Alert role={message.error ? 'alert' : 'status'}>
          {formatFeedback(intl, message.text)}
        </Alert>
      )}
      {signedIn ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              await onAccept(token, create ? householdName : null, displayName);
              return undefined;
            });
          }}
          noValidate
        >
          <Stack align="flex-start" gap="md">
            {create && (
              <TextInput
                label={intl.formatMessage({ id: 'access.householdName' })}
                description={intl.formatMessage({
                  id: 'access.membersSeeItWhenTheyPickAHousehold',
                })}
                w="100%"
                maw="22rem"
                required
                maxLength={80}
                value={householdName}
                disabled={busy}
                onChange={(event) =>
                  setHouseholdName(event.currentTarget.value)
                }
              />
            )}
            <TextInput
              label={intl.formatMessage({ id: 'access.yourName' })}
              description={intl.formatMessage({
                id: 'access.howTheOtherMembersSeeYou',
              })}
              w="100%"
              maw="22rem"
              required
              maxLength={80}
              value={displayName}
              disabled={busy}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
            <Button type="submit" loading={busy}>
              {create
                ? intl.formatMessage({ id: 'access.createHousehold' })
                : intl.formatMessage({ id: 'access.joinHousehold' })}
            </Button>
          </Stack>
        </form>
      ) : signingIn ? (
        <Stack gap="md">
          {signIn}
          <div>
            <Anchor
              component="button"
              type="button"
              size="sm"
              onClick={() => setSigningIn(false)}
            >
              <FormattedMessage id="access.createAccountInstead" />
            </Anchor>
          </div>
        </Stack>
      ) : (
        <Stack gap="md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                await onCreateAccount(token, email, password);
                return undefined;
              });
            }}
            noValidate
          >
            <Stack align="flex-start" gap="md">
              <Title order={3}>
                <FormattedMessage id="access.newToShellter" />
              </Title>
              <Text size="sm">
                <FormattedMessage id="access.createYourAccountWithTheEmailThisLinkWas" />
              </Text>
              <TextInput
                label={intl.formatMessage({ id: 'access.yourEmail' })}
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                w="100%"
                maw="22rem"
                required
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
              <TextInput
                label={intl.formatMessage({ id: 'access.chooseAPassword' })}
                description={intl.formatMessage({
                  id: 'access.8To72Characters',
                })}
                type="password"
                autoComplete="new-password"
                w="100%"
                maw="22rem"
                required
                minLength={8}
                maxLength={72}
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
              <Button type="submit" loading={busy}>
                <FormattedMessage id="access.createAccount" />
              </Button>
            </Stack>
          </form>
          <div>
            <Anchor
              component="button"
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                setSigningIn(true);
                setMessage(undefined);
              }}
            >
              <FormattedMessage id="access.signInInstead" />
            </Anchor>
          </div>
        </Stack>
      )}
    </Stack>
  );
}
