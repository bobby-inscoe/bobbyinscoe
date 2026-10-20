import { Alert, Button, Stack, Text, TextInput, Title } from '@mantine/core';
import { type ReactNode, useEffect, useRef, useState } from 'react';

import type { InvitationPreview } from '@/features/house-scanner/api/household-client';
import { formatDate } from '@/features/house-scanner/utils/format';

interface InvitePanelProps {
  token: string;
  signedIn: boolean;
  onPreview: (token: string) => Promise<InvitationPreview>;
  onStartAccountSetup: (token: string, email: string) => Promise<void>;
  onAccept: (
    token: string,
    householdName: string | null,
    displayName: string,
  ) => Promise<void>;
  // The sign-in form for someone who already has an account.
  signIn: ReactNode;
}

// What an invitation link grants, and the one way through it: a new person enters their email and gets an account
// email, an existing one signs in, and a signed-in person names the household or themselves and accepts.
export function InvitePanel({
  token,
  signedIn,
  onPreview,
  onStartAccountSetup,
  onAccept,
  signIn,
}: InvitePanelProps) {
  const [preview, setPreview] = useState<InvitationPreview | 'loading'>(
    'loading',
  );
  const [email, setEmail] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();
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
  if (preview === 'loading')
    return <Text role="status">Checking the invitation…</Text>;
  if (!preview.valid)
    return (
      <Stack align="flex-start">
        <Title order={2}>This invitation cannot be used</Title>
        <Text>
          It has expired, been used or been revoked. Ask the person who sent it
          for a fresh link.
        </Text>
      </Stack>
    );
  const create = preview.purpose === 'create';
  const from = preview.issuerName ?? 'A House Scanner member';
  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Title order={2}>
          {create
            ? 'Create your own household'
            : `Join ${preview.householdName ?? 'a household'}`}
        </Title>
        <Text>
          {create
            ? `${from} invited you to start your own House Scanner household. It shares nothing with theirs.`
            : `${from} invited you to join their household and share its shortlist.`}{' '}
          The link works until {formatDate(preview.expiresAt)}.
        </Text>
      </Stack>
      {message && (
        <Alert role={message.error ? 'alert' : 'status'}>{message.text}</Alert>
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
        >
          <Stack align="flex-start" gap="md">
            {create && (
              <TextInput
                label="Household name"
                description="Members see it when they pick a household."
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
              label="Your name"
              description="How the other members see you."
              w="100%"
              maw="22rem"
              required
              maxLength={80}
              value={displayName}
              disabled={busy}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
            <Button type="submit" loading={busy}>
              {create ? 'Create household' : 'Join household'}
            </Button>
          </Stack>
        </form>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                await onStartAccountSetup(token, email);
                return 'Check your email. If this address is new, a link to choose your password is on its way. If you already have an account, sign in below.';
              });
            }}
          >
            <Stack align="flex-start" gap="md">
              <Title order={3}>New to House Scanner?</Title>
              <TextInput
                label="Your email"
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
              <Button type="submit" loading={busy}>
                Email me a link
              </Button>
            </Stack>
          </form>
          {signIn}
        </>
      )}
    </Stack>
  );
}
