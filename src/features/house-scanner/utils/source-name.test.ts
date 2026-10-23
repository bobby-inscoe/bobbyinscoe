import { expect, it } from 'vitest';
import { sourceName } from '@/features/house-scanner/utils/source-name';

it('uses broker names for known domains and preserves unfamiliar sources', () => {
  expect(sourceName('www.svenskfast.se')).toBe('Svensk Fastighetsförmedling');
  expect(sourceName('erikolsson.se')).toBe('Erik Olsson');
  expect(sourceName('example.invalid')).toBe('example.invalid');
  expect(sourceName('Added by household')).toBe('Added by household');
});
