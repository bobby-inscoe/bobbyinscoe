import { describe, expect, it } from 'vitest';

import {
  estimatedPositionLabel,
  hasPin,
} from '@/features/house-scanner/utils/listing-position';

const position = {
  longitude: 11.9,
  latitude: 57.7,
  precision: 'address' as const,
  source: 'Synthetic position',
  observedAt: '2026-10-17T10:00:00Z',
};

describe('estimatedPositionLabel', () => {
  it('labels only a position flagged as estimated', () => {
    expect(estimatedPositionLabel({ ...position, estimated: true })).toBe(
      'Estimated from the address',
    );
    expect(
      estimatedPositionLabel({ ...position, estimated: false }),
    ).toBeNull();
    expect(estimatedPositionLabel(position)).toBeNull();
    expect(estimatedPositionLabel(null)).toBeNull();
  });

  it('labels a street-only estimate separately', () => {
    expect(
      estimatedPositionLabel({
        ...position,
        estimated: true,
        source: 'Estimated from the street name (OpenStreetMap)',
      }),
    ).toBe('Approximate street position');
  });

  it('does not change which homes get a pin', () => {
    expect(hasPin({ ...position, estimated: true })).toBe(true);
  });
});
