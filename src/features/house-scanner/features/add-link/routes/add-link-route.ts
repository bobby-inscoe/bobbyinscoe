import { type AnyRoute, createRoute } from '@tanstack/react-router';

export function createAddLinkRoute<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createRoute({
    getParentRoute: () => parentRoute,
    path: 'add-link',
  });
}
