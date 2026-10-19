import type { CheckResult } from './checks';

export function makeRedactor(secrets: readonly string[]) {
  // Longest first, so a secret that contains another is replaced whole.
  const ordered = [...new Set(secrets)]
    .filter((secret) => secret.length > 0)
    .sort((a, b) => b.length - a.length);
  return (text: string) => {
    let out = text;
    for (const secret of ordered) out = out.split(secret).join('[redacted]');
    return out;
  };
}

export function hasFailure(results: readonly CheckResult[]) {
  return results.some((result) => result.status === 'FAIL');
}

export function formatTable(results: readonly CheckResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(
      `${result.status.padEnd(7)} ${result.id}  ${result.title} (${result.durationMs} ms)`,
    );
    lines.push(`        meaning: ${result.meaning}`);
    for (const line of result.observations) lines.push(`        - ${line}`);
  }
  const count = (status: string) =>
    results.filter((r) => r.status === status).length;
  lines.push(
    '',
    `${count('PASS')} passed, ${count('FAIL')} failed, ${count('SKIPPED')} skipped`,
  );
  return lines.join('\n');
}

export function jsonReport(
  results: readonly CheckResult[],
  target: 'hosted' | 'local',
) {
  return {
    tool: 'house-scanner-acceptance',
    reportVersion: 1,
    target,
    ok: !hasFailure(results),
    results: results.map(
      ({ id, title, status, meaning, observations, durationMs }) => ({
        id,
        title,
        status,
        meaning,
        observations,
        durationMs,
      }),
    ),
  };
}
