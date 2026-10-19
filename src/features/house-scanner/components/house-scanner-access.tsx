import {
  Alert,
  Button,
  Checkbox,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { type ReactNode, useState } from 'react';

import { useHouseholdSession } from '@/features/house-scanner/hooks/use-household-session';
import type { Household } from '@/features/house-scanner/types/household';

export function HouseScannerAccess({
  children,
  onDemo,
}: {
  children: (household: Household, signOut: () => void) => ReactNode;
  onDemo: () => void;
}) {
  const session = useHouseholdSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(false);
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
        <Button
          variant="subtle"
          aria-label="Explore the synthetic demo"
          onClick={onDemo}
        >
          Explore demo
        </Button>
      </Stack>
    );
  return (
    <Stack gap="md">
      {message && <Alert role="alert">{message}</Alert>}
      {state.status === 'authenticated' ? (
        children(
          {
            snapshot: state.snapshot,
            userId: state.userId,
            onSaveFavorite: session.onSaveFavorite,
            onSaveFavorites: session.onSaveFavorites,
            onRemoveFavorite: session.onRemoveFavorite,
            onAddManual: session.onAddManual,
            onSaveProfile: session.onSaveProfile,
            onSetHidden: session.onSetHidden,
            onLoadNotes: session.onLoadNotes,
            onSaveNote: session.onSaveNote,
          },
          () => void perform(session.signOut),
        )
      ) : state.status === 'loading' ? (
        <Text role="status">Loading your household…</Text>
      ) : state.status === 'signed-out' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              await session.signInWithCode(email, code, remember);
              setCode('');
            });
          }}
        >
          <Stack align="flex-start" gap="md">
            <Title order={2}>Sign in with your access code</Title>
            <TextInput
              label="Email or username"
              w="100%"
              maw="22rem"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <TextInput
              label="Access code"
              w="100%"
              maw="22rem"
              type="password"
              autoComplete="current-password"
              required
              value={code}
              disabled={busy}
              onChange={(event) => setCode(event.currentTarget.value)}
            />
            <Checkbox
              label="Remember this device"
              description="Leave off on shared devices."
              checked={remember}
              disabled={busy}
              onChange={(event) => setRemember(event.currentTarget.checked)}
            />
            <Button type="submit" loading={busy}>
              Sign in
            </Button>
            <Button
              type="button"
              variant="subtle"
              aria-label="Explore the synthetic demo"
              onClick={onDemo}
            >
              Explore demo
            </Button>
          </Stack>
        </form>
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
              {member.displayName} · {member.householdId.slice(0, 8)}
            </Button>
          ))}
        </Stack>
      ) : (
        <Stack align="flex-start">
          <Text role="alert">
            {state.status === 'nonmember'
              ? 'This account has no active household membership. Ask the household owner to restore access.'
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
