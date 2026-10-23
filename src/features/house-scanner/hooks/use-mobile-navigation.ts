import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { classes } from '@/features/house-scanner/theme/shellter-theme';

// Only page scrolling controls the bars; drawers and maps own their gestures.
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
    const bars = () => [
      header,
      page.querySelector<HTMLElement>(`.${classes.tabBar}`),
    ];
    let previous = window.scrollY;
    let travel = 0;
    const show = () => {
      page.removeAttribute('data-navigation-hidden');
      for (const bar of bars()) if (bar) bar.inert = false;
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
      const delta = y - previous;
      previous = y;
      const nav = bars()[1];
      if (!phone.matches || !nav || y <= (header?.offsetHeight ?? 56)) {
        show();
        return;
      }
      if (
        bars().some((bar) => bar?.querySelector(':focus-visible')) ||
        nav.querySelector('[aria-expanded="true"]')
      ) {
        show();
        return;
      }
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (travel <= -8) show();
      else if (travel >= 24) {
        page.setAttribute('data-navigation-hidden', '');
        for (const bar of bars()) if (bar) bar.inert = true;
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
