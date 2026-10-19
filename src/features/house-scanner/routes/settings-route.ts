import { type AnyRoute, createRoute } from '@tanstack/react-router';

export function createSettingsRoute<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createRoute({
    getParentRoute: () => parentRoute,
    path: 'settings',
  });
}
