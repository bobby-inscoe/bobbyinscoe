import { Anchor, Flex, Stack, Text, Title } from '@mantine/core';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { HouseScannerAccess } from '@/features/house-scanner/components/house-scanner-access';
import { HouseholdWorkspace } from '@/features/house-scanner/components/household-workspace';
import styles from '@/features/house-scanner/components/household-workspace.module.css';
import { SyntheticWorkspace } from '@/features/house-scanner/components/synthetic-workspace';
import { validateBrowseSearch } from '@/features/house-scanner/utils/browse-search';

// On the invitation page: the token in the address, or '' when it is missing or malformed. Elsewhere: null.
function readInviteToken() {
  if (!/^\/projects\/house-scanner\/invite\/?$/.test(window.location.pathname))
    return null;
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  return /^[a-f0-9]{64}$/.test(token) ? token : '';
}

export function HouseScannerPage() {
  const [demo, setDemo] = useState(false);
  const [inviteToken, setInviteToken] = useState(readInviteToken);
  const navigate = useNavigate();
  return (
    <Flex
      component="main"
      justify="center"
      p={{ base: 'xs', md: 'xl' }}
      mih="100svh"
    >
      <Stack className={styles.touch} w="100%" maw="72rem" gap="xs">
        <Anchor
          component={Link}
          to="/"
          size="xs"
          visibleFrom="sm"
          style={{ alignSelf: 'flex-start' }}
        >
          ← Back to the workshop
        </Anchor>
        <div>
          <Title
            order={1}
            size="h2"
            fz={{ base: 'lg', sm: 'h2' }}
            className={styles.pageTitle}
          >
            House Scanner
          </Title>
          <Text size="sm" c="dimmed" visibleFrom="sm">
            A private shared home shortlist.
          </Text>
        </div>
        {demo ? (
          <SyntheticWorkspace onLeaveDemo={() => setDemo(false)} />
        ) : (
          <HouseScannerAccess
            onDemo={() => setDemo(true)}
            inviteToken={inviteToken}
            onInviteDone={() => {
              setInviteToken(null);
              void navigate({
                to: '/projects/house-scanner/listings',
                search: validateBrowseSearch({}),
                replace: true,
              });
            }}
          >
            {(household, signOut) => (
              <HouseholdWorkspace
                key={`${household.snapshot.householdId}:${household.userId}`}
                {...household}
                onDemoToggle={() => setDemo(true)}
                onSignOut={signOut}
              />
            )}
          </HouseScannerAccess>
        )}
      </Stack>
    </Flex>
  );
}
