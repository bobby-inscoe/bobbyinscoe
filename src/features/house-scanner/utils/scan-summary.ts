export interface ScanNote {
  sourceId: string;
  status: 'success' | 'partial' | 'failed';
  note: string;
}

// The database stores one string per edition: "<source>: <status> <note> gaps: <json>" for each
// source, joined by "; ", and cuts it at a length limit. Keep only the readable part of each.
export function readScanSummary(summary: string): ScanNote[] {
  const whole = summary.replace(/ \[summary shortened[^\]]*\]\s*$/, '');
  return whole
    .split(/; (?=[a-z0-9-]+: (?:success|partial|failed) )/)
    .flatMap((part) => {
      const match =
        /^([a-z0-9-]+): (success|partial|failed) (.*?)(?: \[result cap applies\])?(?: gaps: .*)?$/s.exec(
          part,
        );
      return match
        ? [
            {
              sourceId: match[1],
              status: match[2] as ScanNote['status'],
              note: match[3].trim(),
            },
          ]
        : [];
    });
}

export const SCAN_STATUS_LABEL: Record<ScanNote['status'], string> = {
  success: 'Complete coverage',
  partial: 'Partial coverage',
  failed: 'Scan failed',
};
