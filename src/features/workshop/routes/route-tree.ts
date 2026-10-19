import type { AnyRoute } from '@tanstack/react-router';
import { createWorkshopRoute } from '@/features/workshop/routes/workshop-route';

export function createWorkshopRouteTree<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createWorkshopRoute(parentRoute);
}
