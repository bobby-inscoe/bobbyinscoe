import { createTheme, Portal } from '@mantine/core';
import classes from '@/features/house-scanner/theme/shellter.module.css';

export const shellterScope = classes.scope;

export const shellterTheme = createTheme({
  primaryColor: 'moss',
  components: {
    // Portals render outside the page, so each one carries the scope. A shared node would be created once without it.
    Portal: Portal.extend({
      defaultProps: { reuseTargetNode: false, className: shellterScope },
    }),
  },
});
