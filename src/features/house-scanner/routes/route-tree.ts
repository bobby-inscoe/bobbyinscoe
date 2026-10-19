import type { AnyRoute } from '@tanstack/react-router';
import { createAddLinkRoute } from '@/features/house-scanner/routes/add-link-route';
import { createFavoritesRoute } from '@/features/house-scanner/routes/favorites-route';
import { createHouseScannerRoute } from '@/features/house-scanner/routes/house-scanner-route';
import { createListingDetailRoute } from '@/features/house-scanner/routes/listing-detail-route';
import { createListingsRoute } from '@/features/house-scanner/routes/listings-route';
import { createSettingsRoute } from '@/features/house-scanner/routes/settings-route';
import { createSourcesRoute } from '@/features/house-scanner/routes/sources-route';
import { createViewingsRoute } from '@/features/house-scanner/routes/viewings-route';

export function createHouseScannerRouteTree<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  const route = createHouseScannerRoute(parentRoute);
  return route.addChildren([
    createListingsRoute(route),
    createListingDetailRoute(route),
    createFavoritesRoute(route),
    createViewingsRoute(route),
    createAddLinkRoute(route),
    createSourcesRoute(route),
    createSettingsRoute(route),
  ]);
}
