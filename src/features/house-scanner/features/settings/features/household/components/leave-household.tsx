import { Button, Group, Modal, Select, Stack, Text } from '@mantine/core';
import { type RefObject, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import type { HouseholdAccess } from '@/features/house-scanner/api/household-client';
import type { HouseholdAccessActions } from '@/features/house-scanner/types/household';

export function LeaveHousehold({
  actions,
  members,
  userId,
  owner,
  pending,
  perform,
}: {
  actions: RefObject<HouseholdAccessActions>;
  members: HouseholdAccess['members'];
  userId: string;
  owner: boolean;
  pending: string;
  perform: (key: string, action: () => Promise<void>) => Promise<void>;
}) {
  const intl = useIntl();
  const [leaving, setLeaving] = useState(false);
  const [nextOwner, setNextOwner] = useState<string | null>(null);
  const others = members.filter((member) => member.userId !== userId);
  const lastOwner = owner && !others.some((member) => member.role === 'owner');
  const mustHandOver = lastOwner && others.length > 0;
  return (
    <>
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
    </>
  );
}
