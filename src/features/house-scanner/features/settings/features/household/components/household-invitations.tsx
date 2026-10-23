import {
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { type RefObject, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { z } from 'zod';
import type { HouseholdAccess } from '@/features/house-scanner/api/household-client';
import {
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

export function HouseholdInvitations({
  actions,
  invitations,
  owner,
  pending,
  notice,
  setNotice,
  perform,
  load,
}: {
  actions: RefObject<HouseholdAccessActions>;
  invitations: HouseholdAccess['invitations'];
  owner: boolean;
  pending: string;
  notice: Feedback;
  setNotice: (notice: Feedback) => void;
  perform: (key: string, action: () => Promise<void>) => Promise<void>;
  load: () => Promise<void>;
}) {
  const intl = useIntl();
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
    <>
      <Stack gap="md" mt="sm">
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
        {owner && invitations.length > 0 && (
          <Stack gap="xs">
            <Text size="sm">
              <FormattedMessage id="settings.household.pendingJoinLinks" />
            </Text>
            <Text size="sm" c="dimmed">
              <FormattedMessage id="settings.household.lostAnInvitationCopyNewLinkMakesAFresh" />
            </Text>
            {invitations.map((invitation) => (
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
    </>
  );
}
