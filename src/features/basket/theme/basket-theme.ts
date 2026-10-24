import {
  ActionIcon,
  Button,
  CloseButton,
  createTheme,
  Drawer,
  Input,
  Menu,
  Portal,
} from '@mantine/core';
import classes from '@/features/basket/theme/basket.module.css';

export { classes };
export const basketTheme = createTheme({
  defaultRadius: 'lg',
  fontFamily: 'Arial, Helvetica, sans-serif',
  respectReducedMotion: true,
  components: {
    Portal: Portal.extend({
      defaultProps: { reuseTargetNode: false, className: classes.scope },
    }),
    Button: Button.extend({
      defaultProps: { size: 'md', fw: 600 },
      classNames: { root: classes.touch },
    }),
    Input: Input.extend({ classNames: { input: classes.input } }),
    ActionIcon: ActionIcon.extend({
      defaultProps: { size: 44 },
      classNames: { root: classes.square },
    }),
    CloseButton: CloseButton.extend({
      defaultProps: { size: 44 },
      classNames: { root: classes.square },
    }),
    Menu: Menu.extend({ classNames: { item: classes.touch } }),
    Drawer: Drawer.extend({
      defaultProps: {
        position: 'bottom',
        size: 'auto',
        padding: 'lg',
        closeButtonProps: { 'aria-label': 'Close panel' },
      },
      classNames: {
        content: classes.sheet,
        title: classes.sheetTitle,
        body: classes.sheetBody,
      },
    }),
  },
});
