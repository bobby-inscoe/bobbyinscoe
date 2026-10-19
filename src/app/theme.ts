import { Button, type CSSVariablesResolver, createTheme } from '@mantine/core';

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
  colors: {
    moss: [
      '#f4f5ee',
      '#e5e7d8',
      '#cdd1b9',
      '#b2b99a',
      '#969f7c',
      '#7e8966',
      '#687453',
      '#526044',
      '#414e37',
      '#303d2c',
    ],
    flax: [
      '#fcfaf4',
      '#f3eddf',
      '#e9dfc7',
      '#dfd0af',
      '#d4bf97',
      '#c8ad7f',
      '#b89a65',
      '#a38650',
      '#89703f',
      '#6f592f',
    ],
  },
  components: {
    Button: Button.extend({ defaultProps: { size: 'sm', fw: 500 } }),
  },
});

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--mantine-color-body': '#e9e4d8',
    '--mantine-color-text': '#383a2e',
    '--mantine-color-dimmed': '#67695a',
  },
  dark: {},
});
