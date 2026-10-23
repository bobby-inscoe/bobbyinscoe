import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { type ReactNode, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { LanguageSelect } from '@/features/house-scanner/components/language-select';
import { InvitePanel } from '@/features/house-scanner/features/access/components/invite-panel';
import { SetPasswordForm } from '@/features/house-scanner/features/access/components/set-password-form';
import { SignInForm } from '@/features/house-scanner/features/access/components/sign-in-form';
import { useHouseholdSession } from '@/features/house-scanner/features/access/hooks/use-household-session';
import {
  errorFeedback,
  type Feedback,
  formatFeedback,
  messageValue,
} from '@/features/house-scanner/i18n/catalogs';
import type { Household } from '@/features/house-scanner/types/household';

export function HouseScannerAccess({
  children,
  onDemo,
  inviteToken = null,
  onInviteDone,
}: {
  children: (household: Household, signOut: () => void) => ReactNode;
  onDemo?: () => void;
  // Set on the invitation page: the link's token, or '' for a malformed link.
  inviteToken?: string | null;
  onInviteDone?: () => void;
}) {
  const intl = useIntl();

  const session = useHouseholdSession();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Feedback | null>(null);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(errorFeedback(error));
    } finally {
      setBusy(false);
    }
  }
  const state = session.state;
  if (state.status === 'unconfigured')
    return (
      <Stack align="flex-start">
        <LanguageSelect />
        <Title order={2}>
          <FormattedMessage id="access.privateAccessIsNotConfigured" />
        </Title>
        <Text>
          <FormattedMessage id="access.noHouseholdDataIsLoaded" />
        </Text>
        {onDemo && (
          <Button
            variant="filled"
            aria-label={intl.formatMessage({
              id: 'access.exploreTheSyntheticDemo',
            })}
            onClick={onDemo}
          >
            <FormattedMessage id="access.exploreDemo" />
          </Button>
        )}
      </Stack>
    );
  const signedIn =
    state.status === 'authenticated' ||
    state.status === 'nonmember' ||
    state.status === 'choose-household';
  const signIn = (title: ReactNode, demo: boolean) => (
    <SignInForm
      title={title}
      onSignIn={session.signInWithCode}
      onResetPassword={session.requestPasswordReset}
    >
      {demo && onDemo && (
        <Button
          type="button"
          variant="subtle"
          aria-label={intl.formatMessage({
            id: 'access.exploreTheSyntheticDemo',
          })}
          onClick={onDemo}
        >
          <FormattedMessage id="access.exploreDemo" />
        </Button>
      )}
    </SignInForm>
  );
  return (
    <Stack gap="md">
      {state.status !== 'loading' &&
        (state.status !== 'authenticated' ||
          session.passwordSetup ||
          inviteToken !== null) && <LanguageSelect />}
      {message && <Alert role="alert">{formatFeedback(intl, message)}</Alert>}
      {session.linkError && (
        <Alert role="alert">
          <FormattedMessage id="access.thatEmailLinkHasExpiredOrWasAlreadyUsed" />
        </Alert>
      )}
      {session.passwordSetup && signedIn ? (
        <SetPasswordForm
          kind={session.passwordSetup}
          onSave={session.setPassword}
        />
      ) : inviteToken !== null && state.status !== 'loading' ? (
        inviteToken ? (
          <InvitePanel
            token={inviteToken}
            signedIn={signedIn}
            onPreview={session.previewInvitation}
            onCreateAccount={session.createAccount}
            onAccept={async (token, householdName, displayName) => {
              await session.acceptInvitation(token, householdName, displayName);
              onInviteDone?.();
            }}
            signIn={signIn(
              <Title order={3}>
                <FormattedMessage id="access.alreadyHaveAnAccount" />
              </Title>,
              false,
            )}
          />
        ) : (
          <Text role="alert">
            <FormattedMessage id="access.thisInvitationLinkIsIncompleteCopyTheWholeLink" />
          </Text>
        )
      ) : state.status === 'authenticated' ? (
        children(
          {
            snapshot: state.snapshot,
            userId: state.userId,
            onSaveFavorite: session.onSaveFavorite,
            onSaveFavorites: session.onSaveFavorites,
            onRemoveFavorite: session.onRemoveFavorite,
            onAddManual: session.onAddManual,
            onUpdateManual: session.onUpdateManual,
            onDeleteManual: session.onDeleteManual,
            onSaveProfile: session.onSaveProfile,
            onSetHidden: session.onSetHidden,
            onLoadNotes: session.onLoadNotes,
            onSaveNote: session.onSaveNote,
            access: session.access,
          },
          () => void perform(session.signOut),
        )
      ) : state.status === 'loading' ? (
        <Center mih={280}>
          <Stack align="center" gap="sm" role="status">
            <Loader />
            <Text c="dimmed">
              <FormattedMessage id="access.loadingYourHousehold" />
            </Text>
          </Stack>
        </Center>
      ) : state.status === 'signed-out' ? (
        signIn(
          <Title order={2}>
            <FormattedMessage id="access.signIn" />
          </Title>,
          true,
        )
      ) : state.status === 'choose-household' ? (
        <Stack>
          <Text>
            <FormattedMessage id="access.chooseAHousehold" />
          </Text>
          {state.memberships.map((member) => (
            <Button
              key={member.householdId}
              loading={busy}
              onClick={() =>
                void perform(() => session.selectHousehold(member.householdId))
              }
            >
              <FormattedMessage
                id="access.as"
                values={{
                  value0: messageValue(
                    member.householdName ??
                      intl.formatMessage({ id: 'access.household' }),
                  ),
                  value1: messageValue(member.displayName),
                }}
              />
            </Button>
          ))}
        </Stack>
      ) : (
        <Stack align="flex-start">
          <Text role="alert">
            {state.status === 'nonmember'
              ? intl.formatMessage({
                  id: 'access.thisAccountHasNoActiveHouseholdAskAHousehold',
                })
              : formatFeedback(intl, state.message)}
          </Text>
          <Group>
            <Button
              loading={busy}
              onClick={() => void perform(session.refresh)}
            >
              <FormattedMessage id="common.retry" />
            </Button>
            <Button
              variant="default"
              loading={busy}
              onClick={() => void perform(session.signOut)}
            >
              <FormattedMessage id="access.signOut" />
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
