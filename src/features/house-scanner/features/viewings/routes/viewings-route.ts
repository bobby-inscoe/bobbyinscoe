import { type AnyRoute, createRoute } from '@tanstack/react-router';

export function createViewingsRoute<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createRoute({
    getParentRoute: () => parentRoute,
    path: 'viewings',
  });
}
