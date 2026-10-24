import {
  Alert,
  Anchor,
  Box,
  Button,
  Group,
  MantineThemeProvider,
  Stack,
  Title,
} from '@mantine/core';
import { useNetwork } from '@mantine/hooks';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { HouseholdWorkspace } from '@/features/house-scanner/components/household-workspace';
import { SyntheticWorkspace } from '@/features/house-scanner/components/synthetic-workspace';
import { HouseScannerAccess } from '@/features/house-scanner/features/access/components/house-scanner-access';
import { useMobileNavigation } from '@/features/house-scanner/hooks/use-mobile-navigation';
import { useShellterPwa } from '@/features/house-scanner/hooks/use-shellter-pwa';
import { ShellterLanguageProvider } from '@/features/house-scanner/i18n/language-provider';
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
  return (
    <ShellterLanguageProvider>
      <HouseScannerContent />
    </ShellterLanguageProvider>
  );
}

function HouseScannerContent() {
  const intl = useIntl();
  const pageRef = useMobileNavigation();
  useShellterPwa();
  const { online } = useNetwork();

  const [demo, setDemo] = useState(
    () =>
      import.meta.env.DEV &&
      new URLSearchParams(window.location.search).has('demo'),
  );
  const [inviteToken, setInviteToken] = useState(readInviteToken);
  const [demoControlsOpen, setDemoControlsOpen] = useState(true);
  const navigate = useNavigate();
  // The site title lives in index.html; name Shellter in the tab while this page is open.
  useEffect(() => {
    const siteTitle = document.title;
    document.title = 'Shellter';
    return () => {
      document.title = siteTitle;
    };
  }, []);
  return (
    <MantineThemeProvider theme={shellterTheme}>
      <Box
        ref={pageRef}
        component="main"
        className={`${shellterScope} ${classes.page}`}
      >
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
            <Group gap="xs" wrap="wrap" maw="100%" miw={0}>
              {import.meta.env.DEV && demo && (
                <Button
                  size="compact-sm"
                  variant="white"
                  aria-expanded={demoControlsOpen}
                  aria-controls="shellter-demo-controls"
                  onClick={() => setDemoControlsOpen((open) => !open)}
                >
                  <FormattedMessage
                    id={
                      demoControlsOpen
                        ? 'navigation.hideDemoControls'
                        : 'navigation.showDemoControls'
                    }
                  />
                </Button>
              )}
              {/* The demo is a local testing aid, so the deployed site never offers it. */}
              {import.meta.env.DEV && (
                <Button
                  size="compact-sm"
                  variant="white"
                  onClick={() => setDemo(!demo)}
                >
                  {demo
                    ? intl.formatMessage({ id: 'navigation.leaveDemo' })
                    : intl.formatMessage({ id: 'navigation.demo' })}
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
                <FormattedMessage id="navigation.backToTheWorkshop" />
              </Anchor>
            </Group>
          </Group>
        </header>
        <Stack className={classes.content} gap="xs">
          {!online && (
            <Alert color="orange">
              <FormattedMessage id="navigation.offline" />
            </Alert>
          )}
          {import.meta.env.DEV && demo ? (
            <SyntheticWorkspace controlsOpen={demoControlsOpen} />
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
