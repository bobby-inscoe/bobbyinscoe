import type { AnyRoute } from '@tanstack/react-router';
import { createInviteRoute } from '@/features/house-scanner/features/access/routes/invite-route';
import { createAddLinkRoute } from '@/features/house-scanner/features/add-link/routes/add-link-route';
import { createFavoritesRoute } from '@/features/house-scanner/features/favorites/routes/favorites-route';
import { createListingsRoute } from '@/features/house-scanner/features/listings/routes/listings-route';
import { createSettingsRoute } from '@/features/house-scanner/features/settings/routes/settings-route';
import { createViewingsRoute } from '@/features/house-scanner/features/viewings/routes/viewings-route';
import { createHouseScannerRoute } from '@/features/house-scanner/routes/house-scanner-route';
import { createListingDetailRoute } from '@/features/house-scanner/routes/listing-detail-route';
import { createOldPathRoute } from '@/features/house-scanner/routes/old-path-route';

export function createHouseScannerRouteTree<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  const route = createHouseScannerRoute(parentRoute);
  return [
    route.addChildren([
      createListingsRoute(route),
      createListingDetailRoute(route),
      createFavoritesRoute(route),
      createViewingsRoute(route),
      createAddLinkRoute(route),
      createSettingsRoute(route),
      createInviteRoute(route),
    ]),
    createOldPathRoute(parentRoute),
  ];
}
