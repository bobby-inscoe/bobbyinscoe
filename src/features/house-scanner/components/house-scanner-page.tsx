import { Anchor, Button, Flex, Group, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { HouseScannerAccess } from '@/features/house-scanner/components/house-scanner-access';
import { HouseholdWorkspace } from '@/features/house-scanner/components/household-workspace';
import styles from '@/features/house-scanner/components/household-workspace.module.css';
import { SyntheticWorkspace } from '@/features/house-scanner/components/synthetic-workspace';

export function HouseScannerPage() {
  const [demo, setDemo] = useState(false);
  return (
    <Flex
      component="main"
      justify="center"
      p={{ base: 'xs', md: 'xl' }}
      mih="100svh"
    >
      <Stack className={styles.touch} w="100%" maw={1440} gap="xs">
        <Anchor
          component={Link}
          to="/"
          size="xs"
          visibleFrom="sm"
          style={{ alignSelf: 'flex-start' }}
        >
          ← Back to the workshop
        </Anchor>
        <Group justify="space-between">
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
          <Button
            variant="subtle"
            aria-label={demo ? 'Leave demo' : 'Explore the synthetic demo'}
            onClick={() => setDemo(!demo)}
          >
            {demo ? 'Leave demo' : 'Demo'}
          </Button>
        </Group>
        {demo ? (
          <SyntheticWorkspace />
        ) : (
          <HouseScannerAccess>
            {(household) => (
              <HouseholdWorkspace
                key={`${household.snapshot.householdId}:${household.userId}`}
                {...household}
              />
            )}
          </HouseScannerAccess>
        )}
      </Stack>
    </Flex>
  );
}
