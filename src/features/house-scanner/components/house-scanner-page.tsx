import {
  Anchor,
  Box,
  Button,
  Group,
  MantineThemeProvider,
  Stack,
  Title,
} from '@mantine/core';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { HouseScannerAccess } from '@/features/house-scanner/components/house-scanner-access';
import { HouseholdWorkspace } from '@/features/house-scanner/components/household-workspace';
import { SyntheticWorkspace } from '@/features/house-scanner/components/synthetic-workspace';
import {
  classes,
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
      <Box component="main" className={`${shellterScope} ${classes.page}`}>
        <header className={classes.appBar}>
          <Group
            className={classes.appBarInner}
            justify="space-between"
            align="center"
            gap="xs"
          >
            <Title order={1} className={classes.wordmark}>
              Shellter
            </Title>
            <Group gap="md" wrap="nowrap">
              {/* The demo is a local testing aid, so the deployed site never offers it. */}
              {import.meta.env.DEV && (
                <Button
                  size="compact-sm"
                  variant="white"
                  onClick={() => setDemo(!demo)}
                >
                  {demo ? 'Leave demo' : 'Demo'}
                </Button>
              )}
              <Anchor
                component={Link}
                to="/"
                size="sm"
                visibleFrom="sm"
                className={classes.appBarLink}
              >
                <ArrowLeft
                  size={16}
                  aria-hidden
                  className={classes.inlineIcon}
                />
                Back to the workshop
              </Anchor>
            </Group>
          </Group>
        </header>
        <Stack className={classes.content} gap="xs">
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
      </Box>
    </MantineThemeProvider>
  );
}
