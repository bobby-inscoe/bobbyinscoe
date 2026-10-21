import { Button, createTheme } from '@mantine/core';
import { colors } from '@/app/colors';

export const theme = createTheme({
  primaryColor: 'moss',
  primaryShade: 7,
  autoContrast: true,
  fontFamily: 'Arial, Helvetica, sans-serif',
  headings: {
    fontFamily: 'Libron, Georgia, "Times New Roman", serif',
    fontWeight: '400',
  },
  defaultRadius: 'sm',
  respectReducedMotion: true,
  cursorType: 'pointer',
  colors,
  components: {
    Button: Button.extend({ defaultProps: { size: 'sm', fw: 500 } }),
  },
});
