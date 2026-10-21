import { expect, it } from 'vitest';
import { fuzzyMatches } from '@/features/house-scanner/utils/fuzzy-match';

it('matches substrings, accents and case', () => {
  expect(fuzzyMatches('Linnégatan 12, Majorna', 'linnegatan')).toBe(true);
  expect(fuzzyMatches('Linnégatan 12, Majorna', 'GATAN 12')).toBe(true);
  expect(fuzzyMatches('Mölndalsvägen 4', 'molndal')).toBe(true);
});

it('forgives a typo in longer words only', () => {
  expect(fuzzyMatches('Linnégatan 12', 'linegatan')).toBe(true);
  expect(fuzzyMatches('Linnégatan 12', 'linnegaten')).toBe(true);
  expect(fuzzyMatches('Linnégatan 12', 'lin')).toBe(true);
  expect(fuzzyMatches('Linnégatan 12', 'kungsgatan')).toBe(false);
  expect(fuzzyMatches('Linnégatan 12', '14')).toBe(false);
});

it('needs every word to match', () => {
  expect(fuzzyMatches('Linnégatan 12', 'linnegatan 12')).toBe(true);
  expect(fuzzyMatches('Linnégatan 12', 'linnegatan 14')).toBe(false);
});

it('accepts dropped letters and transpositions', () => {
  const title = 'Example balcony home';
  for (const query of ['blcony', 'bcony', 'exmple', 'exampl blc', 'balcnoy'])
    expect(fuzzyMatches(title, query), query).toBe(true);
  expect(fuzzyMatches(title, 'cabin')).toBe(false);
  expect(fuzzyMatches(title, 'xyz')).toBe(false);
});
