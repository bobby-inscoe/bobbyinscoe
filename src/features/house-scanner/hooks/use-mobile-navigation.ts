import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { classes } from '@/features/house-scanner/theme/shellter-theme';

// Only page scrolling controls the bottom navigation; drawers and maps own their gestures.
export function useMobileNavigation() {
  const ref = useRef<HTMLElement>(null);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: Restore navigation when the route changes.
  useEffect(() => {
    const page = ref.current;
    if (!page) return;
    const phone = window.matchMedia('(max-width: 35.99375em)');
    const header = page.querySelector<HTMLElement>('header');
    const tabBar = () => page.querySelector<HTMLElement>(`.${classes.tabBar}`);
    // Set by the first scroll event: reading the position here forced a layout on every route change.
    let previous: number | null = null;
    let travel = 0;
    const show = () => {
      page.removeAttribute('data-navigation-hidden');
      const nav = tabBar();
      if (nav) nav.inert = false;
      travel = 0;
    };
    const scroll = () => {
      const y = Math.max(
        0,
        Math.min(
          window.scrollY,
          document.documentElement.scrollHeight - window.innerHeight,
        ),
      );
      const delta = y - (previous ?? y);
      previous = y;
      const nav = tabBar();
      if (!phone.matches || !nav || y <= (header?.offsetHeight ?? 56)) {
        show();
        return;
      }
      if (
        nav.querySelector(':focus-visible') ||
        nav.querySelector('[aria-expanded="true"]')
      ) {
        show();
        return;
      }
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (travel <= -8) show();
      else if (travel >= 24) {
        page.setAttribute('data-navigation-hidden', '');
        nav.inert = true;
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Tab') show();
    };
    show();
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('keydown', keyboard);
    phone.addEventListener('change', show);
    return () => {
      show();
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('keydown', keyboard);
      phone.removeEventListener('change', show);
    };
  }, [pathname]);
  return ref;
}
