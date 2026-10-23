import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Menu,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { Ellipsis, UserRoundMinus, UserRoundPlus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type { HouseholdAccess } from '@/features/house-scanner/api/household-client';
import { HouseholdInvitations } from '@/features/house-scanner/features/settings/features/household/components/household-invitations';
import { LeaveHousehold } from '@/features/house-scanner/features/settings/features/household/components/leave-household';
import {
  errorFeedback,
  type Feedback,
  formatFeedback,
  messageValue,
} from '@/features/house-scanner/i18n/catalogs';
import { classes } from '@/features/house-scanner/theme/shellter-theme';
import type { HouseholdAccessActions } from '@/features/house-scanner/types/household';

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
  const [notice, setNotice] = useState<Feedback>('');
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
  return (
    <Paper>
      <Stack>
        <Title order={2}>
          <FormattedMessage id="settings.household.household" />
        </Title>
        {error && <Alert role="alert">{formatFeedback(intl, error)}</Alert>}
        <Stack gap="xs">
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
              <Group align="flex-end" wrap="nowrap" maw="30rem">
                <TextInput
                  flex={1}
                  miw={0}
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
        </Stack>
        <Stack gap="xs" mt="sm">
          <Title order={3}>
            <FormattedMessage id="settings.household.members" />
          </Title>
          <Text size="sm" c="dimmed">
            <FormattedMessage
              id="settings.household.of10MemberPlacesUsed"
              values={{
                value0: messageValue(active.length),
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
            {active.map((member) => (
              <Group
                component="li"
                key={member.userId}
                gap="sm"
                justify="space-between"
                wrap="nowrap"
                py="xs"
              >
                <Group gap="xs" className={classes.memberIdentity}>
                  <Text style={{ overflowWrap: 'anywhere' }}>
                    {member.displayName}
                    {member.userId === userId
                      ? intl.formatMessage({ id: 'common.youSuffix' })
                      : ''}
                  </Text>
                  {member.role === 'owner' && (
                    <Badge
                      variant="light"
                      styles={{ label: { lineHeight: 1 } }}
                    >
                      <FormattedMessage id="settings.household.owner" />
                    </Badge>
                  )}
                </Group>
                {owner && member.userId !== userId && (
                  <Menu position="bottom-end" floatingStrategy="fixed">
                    <Menu.Target>
                      <ActionIcon
                        variant="subtle"
                        size="lg"
                        flex="0 0 auto"
                        loading={
                          pending === `owner:${member.userId}` ||
                          pending === `remove:${member.userId}`
                        }
                        aria-label={intl.formatMessage(
                          { id: 'settings.household.memberActions' },
                          { name: member.displayName },
                        )}
                      >
                        <Ellipsis size={20} aria-hidden />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {member.role === 'member' && (
                        <Menu.Item
                          leftSection={<UserRoundPlus size={16} aria-hidden />}
                          disabled={pending !== ''}
                          onClick={() =>
                            void perform(`owner:${member.userId}`, async () => {
                              await actions.current.makeOwner(member.userId);
                              await load();
                            })
                          }
                        >
                          <FormattedMessage id="settings.household.makeOwner" />
                        </Menu.Item>
                      )}
                      <Menu.Item
                        leftSection={<UserRoundMinus size={16} aria-hidden />}
                        color="red"
                        disabled={pending !== ''}
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
                            void perform(
                              `remove:${member.userId}`,
                              async () => {
                                await actions.current.deactivate(member.userId);
                                await load();
                              },
                            );
                        }}
                      >
                        <FormattedMessage id="common.remove" />
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
            ))}
          </Stack>
        </Stack>
        <HouseholdInvitations
          actions={actions}
          invitations={data.invitations}
          owner={owner}
          pending={pending}
          notice={notice}
          setNotice={setNotice}
          perform={perform}
          load={load}
        />
        <Divider mt="sm" />
        <LeaveHousehold
          actions={actions}
          members={active}
          userId={userId}
          owner={owner}
          pending={pending}
          perform={perform}
        />
      </Stack>
    </Paper>
  );
}
