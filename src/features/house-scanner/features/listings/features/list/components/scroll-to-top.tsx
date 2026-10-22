import { ActionIcon, Affix, Transition } from '@mantine/core';
import { useScrollDirection, useWindowScroll } from '@mantine/hooks';
import { ArrowUp } from 'lucide-react';
import { useIntl } from 'react-intl';

// Shown only while the reader scrolls up, past the first screen of the list.
export function ScrollToTop() {
  const intl = useIntl();

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
      <Transition transition="fade" duration={250} mounted={show}>
        {(styles) => (
          <ActionIcon
            style={styles}
            size="lg"
            radius="xl"
            variant="default"
            aria-label={intl.formatMessage({ id: 'navigation.backToTop' })}
            onClick={() => scrollTo({ y: 0 })}
          >
            <ArrowUp size={20} aria-hidden />
          </ActionIcon>
        )}
      </Transition>
    </Affix>
  );
}
