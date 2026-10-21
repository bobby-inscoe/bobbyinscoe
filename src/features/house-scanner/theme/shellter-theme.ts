import {
  ActionIcon,
  Button,
  CloseButton,
  createTheme,
  Input,
  NumberInput,
  Portal,
} from '@mantine/core';
import classes from '@/features/house-scanner/theme/shellter.module.css';

// Layout classes for Shellter's own markup; components take them from here rather than importing CSS.
export { classes };

export const shellterScope = classes.scope;

export const shellterTheme = createTheme({
  primaryColor: 'moss',
  components: {
    // Portals render outside the page, so each one carries the scope. A shared node would be created once without it.
    Portal: Portal.extend({
      defaultProps: { reuseTargetNode: false, className: shellterScope },
    }),
    Button: Button.extend({ classNames: { root: classes.touchTarget } }),
    Input: Input.extend({ classNames: { input: classes.touchTarget } }),
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
