import { type AnyRoute, createRoute } from '@tanstack/react-router';

export function createListingsRoute<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createRoute({
    getParentRoute: () => parentRoute,
    path: 'listings',
  });
}
