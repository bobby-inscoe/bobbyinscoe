import {
  type AnyRoute,
  createRoute,
  lazyRouteComponent,
} from '@tanstack/react-router';

import { validateBrowseSearch } from '@/features/house-scanner/utils/browse-search';

export function createHouseScannerRoute<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createRoute({
    getParentRoute: () => parentRoute,
    path: 'projects/house-scanner',
    validateSearch: validateBrowseSearch,
    component: lazyRouteComponent(
      () => import('@/features/house-scanner/components/house-scanner-page'),
      'HouseScannerPage',
    ),
  });
}
