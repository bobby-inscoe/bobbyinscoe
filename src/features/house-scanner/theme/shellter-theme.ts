import {
  ActionIcon,
  Badge,
  Button,
  CloseButton,
  createTheme,
  Input,
  NumberInput,
  Paper,
  Portal,
} from '@mantine/core';
import classes from '@/features/house-scanner/theme/shellter.module.css';

// Layout classes for Shellter's own markup; components take them from here rather than importing CSS.
export { classes };

export const shellterScope = classes.scope;

export const shellterTheme = createTheme({
  primaryColor: 'moss',
  defaultRadius: 'md',
  components: {
    // "new" is the one warm badge: homes first seen in the latest scan.
    Badge: Badge.extend({
      defaultProps: { radius: 'xl' },
      vars: (_theme, props) =>
        props.variant === 'new'
          ? {
              root: {
                '--badge-bg': 'var(--shellter-apricot)',
                '--badge-color': 'var(--shellter-apricot-ink)',
                '--badge-bd': '0',
              },
            }
          : { root: {} },
    }),
    // Portals render outside the page, so each one carries the scope. A shared node would be created once without it.
    Portal: Portal.extend({
      defaultProps: { reuseTargetNode: false, className: shellterScope },
    }),
    Button: Button.extend({
      defaultProps: { fw: 700 },
      classNames: { root: classes.touchTarget },
    }),
    Input: Input.extend({
      classNames: { input: `${classes.touchTarget} ${classes.inputField}` },
    }),
    Paper: Paper.extend({
      defaultProps: { p: 'md', radius: 'lg' },
      classNames: { root: classes.panel },
    }),
    ActionIcon: ActionIcon.extend({
      classNames: { root: classes.touchSquare },
    }),
    CloseButton: CloseButton.extend({
      classNames: { root: classes.touchSquare },
    }),
    NumberInput: NumberInput.extend({
      classNames: { controls: classes.touchControls },
    }),
  },
});
