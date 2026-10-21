import { type AnyRoute, createRoute, redirect } from '@tanstack/react-router';

// Links sent before the rename, including invitation and password emails, keep their search and session hash.
export function createOldPathRoute<TParent extends AnyRoute>(
  parentRoute: TParent,
) {
  return createRoute({
    getParentRoute: () => parentRoute,
    path: 'projects/house-scanner/$',
    beforeLoad: ({ location }) => {
      throw redirect({
        href: location.href.replace(/^\/projects\/house-scanner/, '/shellter'),
        replace: true,
      });
    },
  });
}
