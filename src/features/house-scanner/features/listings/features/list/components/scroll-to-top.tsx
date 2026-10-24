import { ActionIcon, Affix, Transition } from '@mantine/core';
import { useScrollDirection, useWindowEvent } from '@mantine/hooks';
import { ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { useIntl } from 'react-intl';

// Shown only while the reader scrolls up, past the first screen of the list.
export function ScrollToTop() {
  const intl = useIntl();
  // Read only in scroll events: reading the position at mount forced a layout on every tab reveal.
  const [past, setPast] = useState(false);
  useWindowEvent('scroll', () => setPast(window.scrollY > 400), {
    passive: true,
  });
  const show = useScrollDirection() === 'up' && past;
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
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <ArrowUp size={20} aria-hidden />
          </ActionIcon>
        )}
      </Transition>
    </Affix>
  );
}
