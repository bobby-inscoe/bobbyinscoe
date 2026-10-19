import { Spoiler, Stack, Text, Title } from '@mantine/core';
import { useMemo } from 'react';

import type { Snapshot } from '@/features/house-scanner/types/contracts';
import { formatDate } from '@/features/house-scanner/utils/format';
import { sourceSummaries } from '@/features/house-scanner/utils/listing-view';
import {
  readScanSummary,
  SCAN_STATUS_LABEL,
} from '@/features/house-scanner/utils/scan-summary';

export function SourcesPanel({ snapshot }: { snapshot: Snapshot }) {
  const sources = useMemo(
    () => sourceSummaries(snapshot.listings),
    [snapshot.listings],
  );
  const scanNotes = useMemo(
    () =>
      snapshot.edition ? readScanSummary(snapshot.edition.sourceSummary) : [],
    [snapshot.edition],
  );
  return (
    <Stack>
      <Title order={2}>Sources</Title>
      {sources.length === 0 ? (
        <Text>No source has delivered homes yet.</Text>
      ) : (
        sources.map((source) => {
          const matching = scanNotes.filter((scan) =>
            source.host.includes(scan.sourceId),
          );
          const notes = matching.length ? matching : scanNotes;
          return (
            <Stack key={source.host} gap="xs" component="section">
              <Title order={3}>{source.host}</Title>
              <Text size="sm">
                {source.homes} {source.homes === 1 ? 'home' : 'homes'} · last
                scan{' '}
                {snapshot.edition
                  ? formatDate(snapshot.edition.publishedAt)
                  : 'unknown'}
                {notes[0] ? ` · ${SCAN_STATUS_LABEL[notes[0].status]}` : ''}
              </Text>
              {notes.length > 0 && (
                <Spoiler
                  maxHeight={0}
                  showLabel="More about this scan"
                  hideLabel="Hide"
                >
                  <Stack gap="xs">
                    {notes.map((scan) => (
                      <Text key={scan.sourceId} size="sm">
                        {scan.note}
                      </Text>
                    ))}
                  </Stack>
                </Spoiler>
              )}
            </Stack>
          );
        })
      )}
    </Stack>
  );
}
