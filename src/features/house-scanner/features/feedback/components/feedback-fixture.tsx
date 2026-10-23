import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { createRoot } from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { theme } from '@/app/theme';
import { FeedbackWidget } from '@/features/house-scanner/features/feedback/components/feedback-widget';
import { catalogs } from '@/features/house-scanner/i18n/catalogs';
import {
  shellterScope,
  shellterTheme,
} from '@/features/house-scanner/theme/shellter-theme';

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <MantineProvider
      theme={{ ...theme, ...shellterTheme, colors: theme.colors }}
    >
      <IntlProvider locale="en" messages={catalogs.en}>
        <main className={shellterScope}>
          <FeedbackWidget />
        </main>
      </IntlProvider>
    </MantineProvider>,
  );
