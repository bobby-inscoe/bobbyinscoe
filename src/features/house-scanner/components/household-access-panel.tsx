import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import type { HouseholdAccess } from '@/features/house-scanner/api/household-client';
import type { HouseholdAccessActions } from '@/features/house-scanner/types/household';
import { formatDate } from '@/features/house-scanner/utils/format';

type Purpose = 'create' | 'join';

async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export function HouseholdAccessPanel({
  access,
  userId,
}: {
  access: HouseholdAccessActions;
  userId: string;
}) {
  // The session hands out new functions on every render; the panel reads the latest ones.
  const actions = useRef(access);
  actions.current = access;
  const [data, setData] = useState<HouseholdAccess | null>(null);
  const [error, setError] = useState('');
  // The action in flight, so only its own button shows a spinner.
  const [pending, setPending] = useState('');
  const [name, setName] = useState('');
  const [emails, setEmails] = useState<Record<Purpose, string>>({
    create: '',
    join: '',
  });
  const [emailError, setEmailError] = useState<Purpose | null>(null);
  // The invitation waiting for the sender's confirmation.
  const [confirming, setConfirming] = useState<{
    purpose: Purpose;
    email: string;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [nextOwner, setNextOwner] = useState<string | null>(null);
  const load = useCallback(async () => {
    const value = await actions.current.load();
    setData(value);
    setName(value.name);
  }, []);
  useEffect(() => {
    load().catch(() =>
      setError('Could not load the household members. Reload to try again.'),
    );
  }, [load]);
  async function perform(key: string, action: () => Promise<void>) {
    setPending(key);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Request failed. Try again.',
      );
    } finally {
      setPending((current) => (current === key ? '' : current));
    }
  }
  if (!data)
    return error ? (
      <Text role="alert">{error}</Text>
    ) : (
      <Text role="status">Loading household…</Text>
    );
  const me = data.members.find((member) => member.userId === userId);
  const owner = me?.role === 'owner';
  const active = data.members.filter((member) => member.active);
  const others = active.filter((member) => member.userId !== userId);
  const lastOwner = owner && !others.some((member) => member.role === 'owner');
  const mustHandOver = lastOwner && others.length > 0;
  // Sending waits for the sender's confirmation, which also copies the link.
  const inviteForm = (purpose: Purpose, label: string, description: string) => (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const email = emails[purpose].trim();
        if (!z.email().max(254).safeParse(email).success) {
          setEmailError(purpose);
          return;
        }
        setEmailError(null);
        setConfirming({ purpose, email });
      }}
    >
      <Group align="flex-end" wrap="nowrap" maw="30rem">
        <TextInput
          flex={1}
          label={label}
          description={description}
          type="email"
          autoComplete="off"
          required
          value={emails[purpose]}
          error={emailError === purpose && 'Enter a valid email address.'}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setEmails((current) => ({ ...current, [purpose]: value }));
            setEmailError(null);
          }}
        />
        <Button
          type="submit"
          variant="default"
          w="5rem"
          aria-label={
            purpose === 'create'
              ? 'Send new household invitation'
              : 'Send join invitation'
          }
        >
          Send
        </Button>
      </Group>
    </form>
  );
  return (
    <Paper>
      <Stack>
        <Title order={2}>Household</Title>
        {error && <Alert role="alert">{error}</Alert>}
        {owner ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform('rename', async () => {
                await actions.current.rename(name);
                await load();
              });
            }}
          >
            <Group align="flex-end">
              <TextInput
                label="Household name"
                required
                maxLength={80}
                value={name}
                disabled={pending === 'rename'}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <Button
                type="submit"
                variant="default"
                loading={pending === 'rename'}
                disabled={name.trim() === data.name}
              >
                Rename
              </Button>
            </Group>
          </form>
        ) : (
          <Text>{data.name}</Text>
        )}

        <Title order={3}>Members</Title>
        <Text size="sm" c="dimmed">
          {data.members.filter((member) => member.active).length} of 10 member
          places used.
        </Text>
        <Stack
          gap="xs"
          component="ul"
          p={0}
          m={0}
          style={{ listStyle: 'none' }}
        >
          {data.members
            .filter((member) => member.active)
            .map((member) => (
              <Group component="li" key={member.userId} gap="xs" wrap="wrap">
                <Text>
                  {member.displayName}
                  {member.userId === userId ? ' (you)' : ''}
                </Text>
                {member.role === 'owner' && (
                  <Badge variant="light">Owner</Badge>
                )}
                {owner && member.userId !== userId && (
                  <>
                    {member.role === 'member' && (
                      <Button
                        size="xs"
                        variant="default"
                        loading={pending === `owner:${member.userId}`}
                        onClick={() =>
                          void perform(`owner:${member.userId}`, async () => {
                            await actions.current.makeOwner(member.userId);
                            await load();
                          })
                        }
                      >
                        Make owner
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      loading={pending === `remove:${member.userId}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove ${member.displayName} from this household? Their saves and notes stay, and an owner can invite them back.`,
                          )
                        )
                          void perform(`remove:${member.userId}`, async () => {
                            await actions.current.deactivate(member.userId);
                            await load();
                          });
                      }}
                    >
                      Remove
                    </Button>
                  </>
                )}
              </Group>
            ))}
        </Stack>

        <Title order={3}>Invite people</Title>
        {inviteForm(
          'create',
          'Invite someone to start their own household',
          'Their household shares nothing with yours.',
        )}
        {owner &&
          inviteForm(
            'join',
            'Invite someone to join this household',
            'Only someone who signs in with this email can use the link.',
          )}
        {notice && <Alert role="status">{notice}</Alert>}
        {owner && data.invitations.length > 0 && (
          <Stack gap="xs">
            <Text size="sm">Pending join links</Text>
            <Text size="sm" c="dimmed">
              Lost an invitation? Copy new link makes a fresh link and cancels
              the old one. It sends no email.
            </Text>
            {data.invitations.map((invitation) => (
              <Group key={invitation.id} gap="xs">
                <Text size="sm">
                  {invitation.email} · until {formatDate(invitation.expiresAt)}
                </Text>
                <Button
                  size="xs"
                  variant="default"
                  loading={pending === `renew:${invitation.id}`}
                  onClick={() =>
                    void perform(`renew:${invitation.id}`, async () => {
                      const url = await actions.current.createLink(
                        'join',
                        invitation.email,
                      );
                      setNotice(
                        (await copy(url))
                          ? `Copied a new link for ${invitation.email}. The earlier one no longer works.`
                          : 'The new link could not be copied. Press Copy new link again.',
                      );
                      await load();
                    })
                  }
                >
                  Copy new link
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  loading={pending === `revoke:${invitation.id}`}
                  onClick={() =>
                    void perform(`revoke:${invitation.id}`, async () => {
                      await actions.current.revoke(invitation.id);
                      await load();
                    })
                  }
                >
                  Revoke
                </Button>
              </Group>
            ))}
          </Stack>
        )}

        <Group>
          <Button
            variant="subtle"
            color="red"
            onClick={() => {
              setNextOwner(null);
              setLeaving(true);
            }}
          >
            Leave this household
          </Button>
        </Group>
      </Stack>
      <Modal
        opened={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Send this invitation?"
      >
        <Stack>
          <Text>
            We will email an invitation to {confirming?.email} and copy its link
            to your clipboard, so you can send it yourself too. It works once,
            for 7 days.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              loading={pending === 'send'}
              onClick={() => {
                if (!confirming) return;
                const { purpose, email } = confirming;
                void perform('send', async () => {
                  const url = await actions.current.sendLink(purpose, email);
                  const copied = await copy(url);
                  setEmails((current) => ({ ...current, [purpose]: '' }));
                  setNotice(
                    `Invitation sent to ${email}. ${copied ? 'The link is copied to your clipboard.' : 'The link could not be copied.'}`,
                  );
                  await load();
                }).then(() => setConfirming(null));
              }}
            >
              Send invitation
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={leaving}
        onClose={() => setLeaving(false)}
        title="Leave this household?"
      >
        <Stack>
          {mustHandOver ? (
            <>
              <Text>
                You are the only owner. Choose a member to make an owner before
                you leave.
              </Text>
              <Select
                label="New owner"
                data={others.map((member) => ({
                  value: member.userId,
                  label: member.displayName,
                }))}
                value={nextOwner}
                onChange={setNextOwner}
              />
            </>
          ) : others.length === 0 ? (
            <Text>
              You are the last member, so leaving closes this household. Nothing
              is deleted, and it can be restored on request.
            </Text>
          ) : (
            <Text>
              Your saves and notes stay. An owner can invite you back.
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setLeaving(false)}>
              Stay
            </Button>
            <Button
              color="red"
              loading={pending === 'leave'}
              disabled={mustHandOver && !nextOwner}
              onClick={() =>
                void perform('leave', async () => {
                  if (mustHandOver && nextOwner)
                    await actions.current.makeOwner(nextOwner);
                  await actions.current.leave();
                })
              }
            >
              {mustHandOver ? 'Make owner and leave' : 'Leave household'}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
