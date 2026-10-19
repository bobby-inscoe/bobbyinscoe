import { type AnyRoute, createRoute } from '@tanstack/react-router';

export function createListingDetailRoute<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createRoute({
    getParentRoute: () => parentRoute,
    path: 'listings/$listingId',
  });
}
