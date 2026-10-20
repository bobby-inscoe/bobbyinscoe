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

import type { HouseholdAccess } from '@/features/house-scanner/api/household-client';
import type { HouseholdAccessActions } from '@/features/house-scanner/types/household';
import { formatDate } from '@/features/house-scanner/utils/format';

// A link that was just made, shown so it can be copied by hand when the clipboard is unavailable.
function SharedLink({ url, note }: { url: string; note: string }) {
  return (
    <Stack gap={4} w="100%" maw="36rem">
      <TextInput
        label="Link to share"
        readOnly
        value={url}
        onFocus={(event) => event.currentTarget.select()}
      />
      <Text size="sm" c="dimmed">
        {note}
      </Text>
    </Stack>
  );
}

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
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [joinEmail, setJoinEmail] = useState('');
  const [createdLink, setCreatedLink] = useState<{
    url: string;
    note: string;
  } | null>(null);
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
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Request failed. Try again.',
      );
    } finally {
      setBusy(false);
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
  return (
    <Paper withBorder p="md">
      <Stack>
        <Title order={2}>Household</Title>
        {error && <Alert role="alert">{error}</Alert>}
        {owner ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
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
                disabled={busy}
                onChange={(event) => setName(event.currentTarget.value)}
              />
              <Button
                type="submit"
                variant="default"
                loading={busy}
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
          {data.members.length} of 10 member places used, including former
          members.
        </Text>
        <Stack
          gap="xs"
          component="ul"
          p={0}
          m={0}
          style={{ listStyle: 'none' }}
        >
          {data.members.map((member) => (
            <Group component="li" key={member.userId} gap="xs" wrap="wrap">
              <Text>
                {member.displayName}
                {member.userId === userId ? ' (you)' : ''}
              </Text>
              {member.role === 'owner' && <Badge variant="light">Owner</Badge>}
              {!member.active && <Badge variant="outline">Former member</Badge>}
              {owner && member.active && member.userId !== userId && (
                <>
                  {member.role === 'member' && (
                    <Button
                      size="xs"
                      variant="default"
                      loading={busy}
                      onClick={() =>
                        void perform(async () => {
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
                    loading={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${member.displayName} from this household? Their saves and notes stay, and an owner can invite them back.`,
                        )
                      )
                        void perform(async () => {
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
        <Group>
          <Button
            variant="default"
            loading={busy}
            onClick={() =>
              void perform(async () => {
                const url = await actions.current.createLink('create');
                const copied = await copy(url);
                setCreatedLink({
                  url,
                  note: `${copied ? 'Copied. ' : ''}Anyone you send this to can start their own, separate household. It works once, for 7 days.`,
                });
              })
            }
          >
            Copy a link to create a household
          </Button>
        </Group>
        {owner && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                const url = await actions.current.createLink('join', joinEmail);
                const copied = await copy(url);
                setCreatedLink({
                  url,
                  note: `${copied ? 'Copied. ' : ''}Only someone who signs in with ${joinEmail.trim()} can use it to join. It works once, for 7 days.`,
                });
                setJoinEmail('');
                await load();
              });
            }}
          >
            <Group align="flex-end">
              <TextInput
                label="Invite someone to join this household"
                description="Enter their email. You send them the link yourself."
                type="email"
                required
                value={joinEmail}
                disabled={busy}
                onChange={(event) => setJoinEmail(event.currentTarget.value)}
              />
              <Button type="submit" variant="default" loading={busy}>
                Copy a join link
              </Button>
            </Group>
          </form>
        )}
        {createdLink && <SharedLink {...createdLink} />}
        {owner && data.invitations.length > 0 && (
          <Stack gap="xs">
            <Text size="sm">Pending join links</Text>
            {data.invitations.map((invitation) => (
              <Group key={invitation.id} gap="xs">
                <Text size="sm">
                  {invitation.email} · until {formatDate(invitation.expiresAt)}
                </Text>
                <Button
                  size="xs"
                  variant="subtle"
                  loading={busy}
                  onClick={() =>
                    void perform(async () => {
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
                comboboxProps={{ withinPortal: false }}
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
              loading={busy}
              disabled={mustHandOver && !nextOwner}
              onClick={() =>
                void perform(async () => {
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
