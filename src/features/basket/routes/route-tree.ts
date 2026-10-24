import { type AnyRoute, createRoute } from '@tanstack/react-router';
import { BasketPage } from '@/features/basket/components/basket-page';
import { searchSchema } from '@/features/basket/types/contracts';

export function createBasketRouteTree<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createRoute({
    getParentRoute: () => parentRoute,
    path: 'basket',
    validateSearch: (search) => searchSchema.parse(search),
    component: BasketPage,
  });
}
