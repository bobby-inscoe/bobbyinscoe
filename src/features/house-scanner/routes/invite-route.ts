import { type AnyRoute, createRoute } from '@tanstack/react-router';

// The page reads the token from the address itself; this route only makes the path match.
export function createInviteRoute<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createRoute({
    getParentRoute: () => parentRoute,
    path: 'invite',
  });
}
