import type { CSSVariablesResolver, MantineColorsTuple } from '@mantine/core';

export const colors: Record<string, MantineColorsTuple> = {
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
};

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    '--site-focus-ring': '#854a31',
    '--site-selection-color': '#f7f0df',
    '--site-selection-bg': '#686b50',
  },
  light: {
    '--mantine-color-body': '#e9e4d8',
    '--mantine-color-text': '#383a2e',
    '--mantine-color-dimmed': '#67695a',
  },
  dark: {},
});
