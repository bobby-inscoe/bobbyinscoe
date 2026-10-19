import { type AnyRoute, createRoute } from '@tanstack/react-router';

import { DuckFeedPage } from '@/features/duck-feed/components/duck-feed-page';

export function createDuckFeedRoute<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createRoute({
    getParentRoute: () => parentRoute,
    path: 'duck-feed',
    component: DuckFeedPage,
  });
}
