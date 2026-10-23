import { Anchor, Stack, Text, Title } from '@mantine/core';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useLayoutEffect } from 'react';
import { applyAppMetadata } from '@/app/app-metadata';

export function AppShell() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  useLayoutEffect(() => applyAppMetadata(pathname), [pathname]);
  return <Outlet />;
}

export function NotFound() {
  return (
    <Stack component="main" gap="lg" px="8vw" py="15vh" align="flex-start">
      <Text size="xs" tt="uppercase">
        Bobby Inscoe
      </Text>
      <Title order={1} fz={{ base: 40, sm: 64 }}>
        A little off the path.
      </Title>
      <Text>There isn’t a project at this address.</Text>
      <Anchor component={Link} to="/">
        Back to projects ↗
      </Anchor>
    </Stack>
  );
}
