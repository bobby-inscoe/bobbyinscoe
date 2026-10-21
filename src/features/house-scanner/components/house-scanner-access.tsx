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

import { InvitePanel } from '@/features/house-scanner/components/invite-panel';
import { SetPasswordForm } from '@/features/house-scanner/components/set-password-form';
import { SignInForm } from '@/features/house-scanner/components/sign-in-form';
import { useHouseholdSession } from '@/features/house-scanner/hooks/use-household-session';
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
  const session = useHouseholdSession();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Request failed. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  const state = session.state;
  if (state.status === 'unconfigured')
    return (
      <Stack>
        <Title order={2}>Private access is not configured</Title>
        <Text>No household data is loaded.</Text>
        {onDemo && (
          <Button
            variant="subtle"
            aria-label="Explore the synthetic demo"
            onClick={onDemo}
          >
            Explore demo
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
          aria-label="Explore the synthetic demo"
          onClick={onDemo}
        >
          Explore demo
        </Button>
      )}
    </SignInForm>
  );
  return (
    <Stack gap="md">
      {message && <Alert role="alert">{message}</Alert>}
      {session.linkError && (
        <Alert role="alert">
          That email link has expired or was already used. Ask for a new
          invitation, or use Forgot password to get a fresh link.
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
              <Title order={3}>Already have an account?</Title>,
              false,
            )}
          />
        ) : (
          <Text role="alert">
            This invitation link is incomplete. Copy the whole link and try
            again.
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
            <Text c="dimmed">Loading your household…</Text>
          </Stack>
        </Center>
      ) : state.status === 'signed-out' ? (
        signIn(<Title order={2}>Sign in</Title>, true)
      ) : state.status === 'choose-household' ? (
        <Stack>
          <Text>Choose a household.</Text>
          {state.memberships.map((member) => (
            <Button
              key={member.householdId}
              loading={busy}
              onClick={() =>
                void perform(() => session.selectHousehold(member.householdId))
              }
            >
              {member.householdName ?? 'Household'} · as {member.displayName}
            </Button>
          ))}
        </Stack>
      ) : (
        <Stack align="flex-start">
          <Text role="alert">
            {state.status === 'nonmember'
              ? 'This account has no active household. Ask a household owner for a link to join, or a member for a link to create your own.'
              : state.message}
          </Text>
          <Group>
            <Button
              loading={busy}
              onClick={() => void perform(session.refresh)}
            >
              Retry
            </Button>
            <Button
              variant="default"
              loading={busy}
              onClick={() => void perform(session.signOut)}
            >
              Sign out
            </Button>
          </Group>
        </Stack>
      )}
    </Stack>
  );
}
