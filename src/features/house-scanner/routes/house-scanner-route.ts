import {
  type AnyRoute,
  createRoute,
  lazyRouteComponent,
} from '@tanstack/react-router';

import {
  toUrlSearch,
  validateBrowseSearch,
} from '@/features/house-scanner/utils/browse-search';

export function createHouseScannerRoute<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createRoute({
    getParentRoute: () => parentRoute,
    path: 'shellter',
    validateSearch: (search: Record<string, unknown>) =>
      toUrlSearch(validateBrowseSearch(search)),
    component: lazyRouteComponent(
      () => import('@/features/house-scanner/components/house-scanner-page'),
      'HouseScannerPage',
    ),
  });
}
