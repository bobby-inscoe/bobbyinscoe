import { groundFloorOf } from '@house-scanner-tools/floor';
import { expect, it } from 'vitest';

it.each([
  // Floor 2 or higher is above ground whatever the numbering.
  ['2', false],
  ['3', false],
  [' 12 ', false],
  ['3 av 5', false],
  ['2-3 av 4', false],
  [2, false],
  [7, false],
  // Floor 1 may be the ground floor or one above it.
  ['1', null],
  ['1 av 5', null],
  [1, null],
  // Only an explicit marker or 0 proves the ground floor.
  ['0', true],
  [0, true],
  ['BV', true],
  ['bv', true],
  ['BV av 5', true],
  ['Bottenvåning', true],
  ['bottenvaning', true],
  // Anything else stays unknown.
  ['', null],
  ['   ', null],
  [null, null],
  [undefined, null],
  ['vind', null],
  ['-1', null],
  ['1,5', null],
  ['2.5', null],
  [2.5, null],
  ['1234', null],
  ['BVX', null],
  [{}, null],
  [true, null],
])('reads floor %j as groundFloor %j', (floor, groundFloor) => {
  expect(groundFloorOf(floor)).toBe(groundFloor);
});
