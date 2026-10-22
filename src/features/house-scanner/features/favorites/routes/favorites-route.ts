import { type AnyRoute, createRoute } from '@tanstack/react-router';

export function createFavoritesRoute<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createRoute({
    getParentRoute: () => parentRoute,
    path: 'favorites',
  });
}
