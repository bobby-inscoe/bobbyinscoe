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
import { FormattedMessage, useIntl } from 'react-intl';
import { z } from 'zod';
import type { HouseholdAccess } from '@/features/house-scanner/api/household-client';
import {
  errorFeedback,
  type Feedback,
  formatFeedback,
  messageValue,
} from '@/features/house-scanner/i18n/catalogs';
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
  const intl = useIntl();

  // The session hands out new functions on every render; the panel reads the latest ones.
  const actions = useRef(access);
  actions.current = access;
  const [data, setData] = useState<HouseholdAccess | null>(null);
  const [error, setError] = useState<Feedback>('');
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
  const [notice, setNotice] = useState<Feedback>('');
  const [leaving, setLeaving] = useState(false);
  const [nextOwner, setNextOwner] = useState<string | null>(null);
  const load = useCallback(async () => {
    const value = await actions.current.load();
    setData(value);
    setName(value.name);
  }, []);
  useEffect(() => {
    load().catch(() =>
      setError('settings.household.couldNotLoadTheHouseholdMembersReloadToTry'),
    );
  }, [load]);
  async function perform(key: string, action: () => Promise<void>) {
    setPending(key);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (failure) {
      setError(errorFeedback(failure));
    } finally {
      setPending((current) => (current === key ? '' : current));
    }
  }
  if (!data)
    return error ? (
      <Text role="alert">{formatFeedback(intl, error)}</Text>
    ) : (
      <Text role="status">
        <FormattedMessage id="settings.household.loadingHousehold" />
      </Text>
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
          placeholder="name@example.com"
          autoComplete="off"
          required
          value={emails[purpose]}
          error={
            emailError === purpose &&
            intl.formatMessage({
              id: 'settings.household.enterAValidEmailAddress',
            })
          }
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
              ? intl.formatMessage({
                  id: 'settings.household.sendNewHouseholdInvitation',
                })
              : intl.formatMessage({
                  id: 'settings.household.sendJoinInvitation',
                })
          }
        >
          <FormattedMessage id="settings.household.send" />
        </Button>
      </Group>
    </form>
  );
  return (
    <Paper>
      <Stack>
        <Title order={2}>
          <FormattedMessage id="settings.household.household" />
        </Title>
        {error && <Alert role="alert">{formatFeedback(intl, error)}</Alert>}
        {owner ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void perform('rename', async () => {
                await actions.current.rename(name);
                await load();
              });
            }}
            noValidate
          >
            <Group align="flex-end">
              <TextInput
                label={intl.formatMessage({
                  id: 'settings.household.householdName',
                })}
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
                <FormattedMessage id="settings.household.rename" />
              </Button>
            </Group>
          </form>
        ) : (
          <Text>{data.name}</Text>
        )}

        <Title order={3}>
          <FormattedMessage id="settings.household.members" />
        </Title>
        <Text size="sm" c="dimmed">
          <FormattedMessage
            id="settings.household.of10MemberPlacesUsed"
            values={{
              value0: messageValue(
                data.members.filter((member) => member.active).length,
              ),
            }}
          />
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
                  {member.userId === userId
                    ? intl.formatMessage({ id: 'common.youSuffix' })
                    : ''}
                </Text>
                {member.role === 'owner' && (
                  <Badge variant="light">
                    <FormattedMessage id="settings.household.owner" />
                  </Badge>
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
                        <FormattedMessage id="settings.household.makeOwner" />
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
                            intl.formatMessage(
                              {
                                id: 'settings.household.removeFromThisHouseholdTheirSavesAndNotesStay',
                              },
                              { value0: messageValue(member.displayName) },
                            ),
                          )
                        )
                          void perform(`remove:${member.userId}`, async () => {
                            await actions.current.deactivate(member.userId);
                            await load();
                          });
                      }}
                    >
                      <FormattedMessage id="common.remove" />
                    </Button>
                  </>
                )}
              </Group>
            ))}
        </Stack>

        <Title order={3}>
          <FormattedMessage id="settings.household.invitePeople" />
        </Title>
        {inviteForm(
          'create',
          intl.formatMessage({
            id: 'settings.household.inviteSomeoneToStartTheirOwnHousehold',
          }),
          intl.formatMessage({
            id: 'settings.household.theirHouseholdSharesNothingWithYours',
          }),
        )}
        {owner &&
          inviteForm(
            'join',
            intl.formatMessage({
              id: 'settings.household.inviteSomeoneToJoinThisHousehold',
            }),
            intl.formatMessage({
              id: 'settings.household.onlySomeoneWhoSignsInWithThisEmailCan',
            }),
          )}
        {notice && <Alert role="status">{formatFeedback(intl, notice)}</Alert>}
        {owner && data.invitations.length > 0 && (
          <Stack gap="xs">
            <Text size="sm">
              <FormattedMessage id="settings.household.pendingJoinLinks" />
            </Text>
            <Text size="sm" c="dimmed">
              <FormattedMessage id="settings.household.lostAnInvitationCopyNewLinkMakesAFresh" />
            </Text>
            {data.invitations.map((invitation) => (
              <Group key={invitation.id} gap="xs">
                <Text size="sm">
                  <FormattedMessage
                    id="settings.household.until"
                    values={{
                      value0: messageValue(invitation.email),
                      value1: messageValue(
                        formatDate(invitation.expiresAt, intl),
                      ),
                    }}
                  />
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
                          ? {
                              id: 'settings.household.copiedANewLinkForTheEarlierOneNo',
                              values: { value0: invitation.email },
                            }
                          : 'settings.household.theNewLinkCouldNotBeCopiedPressCopy',
                      );
                      await load();
                    })
                  }
                >
                  <FormattedMessage id="settings.household.copyNewLink" />
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
                  <FormattedMessage id="settings.household.revoke" />
                </Button>
              </Group>
            ))}
          </Stack>
        )}

        <Group>
          <Button
            variant="light"
            color="red"
            onClick={() => {
              setNextOwner(null);
              setLeaving(true);
            }}
          >
            <FormattedMessage id="settings.household.leaveThisHousehold" />
          </Button>
        </Group>
      </Stack>
      <Modal
        opened={confirming !== null}
        onClose={() => setConfirming(null)}
        title={intl.formatMessage({
          id: 'settings.household.sendThisInvitation',
        })}
        closeButtonProps={{
          'aria-label': intl.formatMessage({ id: 'common.close' }),
        }}
      >
        <Stack>
          <Text>
            <FormattedMessage
              id="settings.household.weWillEmailAnInvitationToAndCopyIts"
              values={{ value0: messageValue(confirming?.email) }}
            />
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(null)}>
              <FormattedMessage id="common.cancel" />
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
                  setNotice({
                    id: 'settings.household.invitationSent',
                    values: { email, copied: copied ? 'yes' : 'no' },
                  });
                  await load();
                }).then(() => setConfirming(null));
              }}
            >
              <FormattedMessage id="settings.household.sendInvitation" />
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={leaving}
        onClose={() => setLeaving(false)}
        title={intl.formatMessage({
          id: 'settings.household.leaveThisHousehold2',
        })}
        closeButtonProps={{
          'aria-label': intl.formatMessage({ id: 'common.close' }),
        }}
      >
        <Stack>
          {mustHandOver ? (
            <>
              <Text>
                <FormattedMessage id="settings.household.youAreTheOnlyOwnerChooseAMemberTo" />
              </Text>
              <Select
                label={intl.formatMessage({
                  id: 'settings.household.newOwner',
                })}
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
              <FormattedMessage id="settings.household.youAreTheLastMemberSoLeavingClosesThis" />
            </Text>
          ) : (
            <Text>
              <FormattedMessage id="settings.household.yourSavesAndNotesStayAnOwnerCanInvite" />
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setLeaving(false)}>
              <FormattedMessage id="settings.household.stay" />
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
              {mustHandOver
                ? intl.formatMessage({
                    id: 'settings.household.makeOwnerAndLeave',
                  })
                : intl.formatMessage({
                    id: 'settings.household.leaveHousehold',
                  })}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}
