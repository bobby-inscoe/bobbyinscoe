import { Anchor, Stack, Text, Title } from '@mantine/core';
import { Link, Outlet } from '@tanstack/react-router';

export function AppShell() {
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
