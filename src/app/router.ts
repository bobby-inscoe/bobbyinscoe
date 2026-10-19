import { createRootRoute, createRouter } from '@tanstack/react-router';
import { AppShell, NotFound } from '@/app/app-shell';
import { createDuckFeedRouteTree } from '@/features/duck-feed/routes/route-tree';
import { createHouseScannerRouteTree } from '@/features/house-scanner/routes/route-tree';
import { createWorkshopRouteTree } from '@/features/workshop/routes/route-tree';

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFound,
});
const routeTree = rootRoute.addChildren([
  createWorkshopRouteTree(rootRoute),
  createDuckFeedRouteTree(rootRoute),
  createHouseScannerRouteTree(rootRoute),
]);
export const router = createRouter({ routeTree, scrollRestoration: true });
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
