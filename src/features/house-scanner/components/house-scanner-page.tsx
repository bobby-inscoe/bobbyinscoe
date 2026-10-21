import {
  Anchor,
  Button,
  Flex,
  Group,
  MantineThemeProvider,
  Stack,
  Title,
} from '@mantine/core';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { HouseScannerAccess } from '@/features/house-scanner/components/house-scanner-access';
import { HouseholdWorkspace } from '@/features/house-scanner/components/household-workspace';
import { SyntheticWorkspace } from '@/features/house-scanner/components/synthetic-workspace';
import {
  shellterScope,
  shellterTheme,
} from '@/features/house-scanner/theme/shellter-theme';

// On the invitation page: the token in the address, or '' when it is missing or malformed. Elsewhere: null.
function readInviteToken() {
  if (!/^\/shellter\/invite\/?$/.test(window.location.pathname)) return null;
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  return /^[a-f0-9]{64}$/.test(token) ? token : '';
}

export function HouseScannerPage() {
  const [demo, setDemo] = useState(false);
  const [inviteToken, setInviteToken] = useState(readInviteToken);
  const navigate = useNavigate();
  return (
    <MantineThemeProvider theme={shellterTheme}>
      <Flex
        component="main"
        justify="center"
        p={{ base: 'xs', md: 'xl' }}
        mih="100svh"
      >
        <Stack className={shellterScope} w="100%" maw="72rem" gap="xs">
          <Group justify="space-between" align="center" wrap="nowrap">
            <Anchor component={Link} to="/" size="xs" visibleFrom="sm">
              ← Back to the workshop
            </Anchor>
            <Group gap="xs" ml="auto" wrap="nowrap">
              {/* The demo is a local testing aid, so the deployed site never offers it. */}
              {import.meta.env.DEV && (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setDemo(!demo)}
                >
                  {demo ? 'Leave demo' : 'Demo'}
                </Button>
              )}
              <Title order={1} size="h2" fz={{ base: 'lg', sm: 'h2' }}>
                Shellter
              </Title>
            </Group>
          </Group>
          {demo ? (
            <SyntheticWorkspace />
          ) : (
            <HouseScannerAccess
              onDemo={import.meta.env.DEV ? () => setDemo(true) : undefined}
              inviteToken={inviteToken}
              onInviteDone={() => {
                setInviteToken(null);
                void navigate({
                  to: '/shellter/listings',
                  search: {},
                  replace: true,
                });
              }}
            >
              {(household, signOut) => (
                <HouseholdWorkspace
                  key={`${household.snapshot.householdId}:${household.userId}`}
                  {...household}
                  onSignOut={signOut}
                />
              )}
            </HouseScannerAccess>
          )}
        </Stack>
      </Flex>
    </MantineThemeProvider>
  );
}
