import { MantineProvider } from '@mantine/core';
import { RouterProvider } from '@tanstack/react-router';
import { cssVariablesResolver } from '@/app/colors';
import { router } from '@/app/router';
import { theme } from '@/app/theme';

export function App() {
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      forceColorScheme="light"
    >
      <RouterProvider router={router} />
    </MantineProvider>
  );
}
