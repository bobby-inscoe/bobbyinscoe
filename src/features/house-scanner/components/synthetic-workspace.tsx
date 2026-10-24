import { Alert, Button, Group, Select, Stack } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { HouseholdWorkspace } from '@/features/house-scanner/components/household-workspace';
import { HouseScannerAccessView } from '@/features/house-scanner/features/access/components/house-scanner-access';
import type { useHouseholdSession } from '@/features/house-scanner/features/access/hooks/use-household-session';
import { useDemoHousehold } from '@/features/house-scanner/hooks/use-demo-household';
import { DEMO_USER_ID } from '@/features/house-scanner/mock/synthetic-household';

const screens = [
  'app',
  'signed-out',
  'create',
  'join',
  'new-household',
  'recovery',
  'nonmember',
] as const;
type DemoScreen = (typeof screens)[number];

export function SyntheticWorkspace() {
  const intl = useIntl();
  const navigate = useNavigate();
  const [screen, setScreen] = useState<DemoScreen>(() => {
    const requested = new URLSearchParams(window.location.search).get('demo');
    return requested === 'create' || requested === 'join' ? requested : 'app';
  });
  const [reset, setReset] = useState(0);
  function restart(next: DemoScreen) {
    setScreen(next);
    setReset((value) => value + 1);
    void navigate({ to: '/shellter/listings', search: {}, replace: true });
  }
  return (
    <Stack gap="md">
      <Alert>
        <Stack gap="xs">
          <FormattedMessage id="navigation.demoPreviewNotice" />
          <Group align="flex-end">
            <Select
              w="22rem"
              maw="100%"
              label={intl.formatMessage({ id: 'navigation.demoScreen' })}
              value={screen}
              allowDeselect={false}
              data={screens.map((value) => ({
                value,
                label: intl.formatMessage({
                  id: `navigation.demoScreens.${value}`,
                }),
              }))}
              onChange={(value) => {
                if (value && screens.includes(value as DemoScreen))
                  restart(value as DemoScreen);
              }}
            />
            <Button variant="default" onClick={() => restart(screen)}>
              <FormattedMessage id="navigation.restartDemoScreen" />
            </Button>
          </Group>
        </Stack>
      </Alert>
      <DemoSession key={`${screen}:${reset}`} screen={screen} />
    </Stack>
  );
}

function DemoSession({ screen }: { screen: DemoScreen }) {
  const navigate = useNavigate();
  const demo = useDemoHousehold(
    screen === 'create' || screen === 'new-household',
  );
  const [status, setStatus] = useState<
    'authenticated' | 'signed-out' | 'nonmember'
  >(
    screen === 'signed-out' || screen === 'create' || screen === 'join'
      ? 'signed-out'
      : screen === 'nonmember'
        ? 'nonmember'
        : 'authenticated',
  );
  const [inviteToken, setInviteToken] = useState<string | null>(
    screen === 'create' || screen === 'join' ? screen : null,
  );
  const [passwordSetup, setPasswordSetup] = useState<'recovery' | null>(
    screen === 'recovery' ? 'recovery' : null,
  );
  // No live session hook is mounted while previewing; every action below stays in memory.
  const session: ReturnType<typeof useHouseholdSession> = {
    state:
      status === 'authenticated'
        ? { status, snapshot: demo.snapshot, userId: DEMO_USER_ID }
        : { status },
    passwordSetup,
    linkError: false,
    signInWithCode: async () => {
      setStatus('authenticated');
    },
    signOut: async () => {
      setInviteToken(null);
      setStatus('signed-out');
    },
    refresh: async () => {},
    requestPasswordReset: async () => {},
    setPassword: async () => {
      setPasswordSetup(null);
    },
    previewInvitation: async () => ({
      valid: true,
      purpose: screen === 'create' ? 'create' : 'join',
      issuerName: 'Demo Morgan',
      householdName: screen === 'create' ? null : 'Demo household',
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    }),
    createAccount: async () => {
      setStatus('authenticated');
    },
    acceptInvitation: async (_token, name, displayName) => {
      await demo.acceptInvitation(name, displayName);
    },
    selectHousehold: async () => {},
    access: demo.access,
    onSaveFavorite: demo.saveFavorite,
    onSaveFavorites: demo.saveFavorites,
    onRemoveFavorite: demo.removeFavorite,
    onAddManual: demo.addManual,
    onUpdateManual: demo.updateManual,
    onDeleteManual: demo.deleteManual,
    onSaveProfile: demo.saveProfile,
    onSetHidden: demo.setHidden,
    onLoadNotes: demo.loadNotes,
    onSaveNote: demo.saveNote,
  };
  return (
    <HouseScannerAccessView
      session={session}
      inviteToken={inviteToken}
      onInviteDone={() => {
        setInviteToken(null);
        void navigate({ to: '/shellter/listings', search: {}, replace: true });
      }}
    >
      {(household, signOut) => (
        <HouseholdWorkspace {...household} onSignOut={signOut} />
      )}
    </HouseScannerAccessView>
  );
}
