import { describe, expect, it } from 'vitest';
import { readScanSummary } from '@/features/house-scanner/utils/scan-summary';

describe('readScanSummary', () => {
  it('drops the policy gap list and the shortened marker', () => {
    const summary =
      'boneo: partial Read 609 homes across 25 pages; kept 72 that fit your profile and dropped 537. Not covered: houses. gaps: ["Only the Till salu view was observed.", "Photos are [summary shortened; review run coverage details]';
    expect(readScanSummary(summary)).toEqual([
      {
        sourceId: 'boneo',
        status: 'partial',
        note: 'Read 609 homes across 25 pages; kept 72 that fit your profile and dropped 537. Not covered: houses.',
      },
    ]);
  });

  it('separates several sources and drops the result cap marker', () => {
    const summary =
      'alpha: success All read. [result cap applies] gaps: []; beta: failed Blocked. gaps: ["x"]';
    expect(readScanSummary(summary)).toEqual([
      { sourceId: 'alpha', status: 'success', note: 'All read.' },
      { sourceId: 'beta', status: 'failed', note: 'Blocked.' },
    ]);
  });

  it('keeps a semicolon that is inside a note', () => {
    expect(
      readScanSummary('boneo: partial Kept 3; dropped 4. gaps: []'),
    ).toEqual([
      { sourceId: 'boneo', status: 'partial', note: 'Kept 3; dropped 4.' },
    ]);
  });

  it('returns nothing for text it does not recognise', () => {
    expect(readScanSummary('')).toEqual([]);
    expect(readScanSummary('something else entirely')).toEqual([]);
  });
});
