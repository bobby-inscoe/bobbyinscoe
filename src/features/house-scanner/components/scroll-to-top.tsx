import { ActionIcon, Affix, Transition } from '@mantine/core';
import { useScrollDirection, useWindowScroll } from '@mantine/hooks';
import { ArrowUp } from 'lucide-react';

// Shown only while the reader scrolls up, past the first screen of the list.
export function ScrollToTop() {
  const [scroll, scrollTo] = useWindowScroll();
  const show = useScrollDirection() === 'up' && scroll.y > 400;
  return (
    <Affix
      position={{
        bottom:
          'calc(var(--shellter-tabbar-height) + env(safe-area-inset-bottom) + 24px)',
        right: 12,
      }}
    >
      <Transition transition="slide-up" mounted={show}>
        {(styles) => (
          <ActionIcon
            style={styles}
            size="lg"
            radius="xl"
            variant="default"
            opacity={0.85}
            aria-label="Back to top"
            onClick={() => scrollTo({ y: 0 })}
          >
            <ArrowUp size={20} aria-hidden />
          </ActionIcon>
        )}
      </Transition>
    </Affix>
  );
}
