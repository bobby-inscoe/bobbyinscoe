import { boneoFixture } from '@house-scanner-tools/live-test-helpers';
import { parseRobots, robotsAllows } from '@house-scanner-tools/robots';
import { partitionUrl } from '@house-scanner-tools/source-adapters';
import { describe, expect, it } from 'vitest';

const ROBOTS = boneoFixture('robots.txt');

describe('robots rules', () => {
  it('applies the longest match and lets allow win ties', () => {
    const rules = parseRobots(
      'User-agent: *\nDisallow: /sv/\nAllow: /sv/till_salu/\nDisallow: /*.json$\n',
    );
    expect(robotsAllows(rules, '/sv/till_salu/x')).toBe(true);
    expect(robotsAllows(rules, '/sv/andra')).toBe(false);
    expect(robotsAllows(rules, '/data.json')).toBe(false);
    expect(robotsAllows(rules, '/data.json?x=1')).toBe(true);
  });

  it('prefers a group naming this reader over the wildcard group', () => {
    const rules = parseRobots(
      'User-agent: *\nAllow: /\n\nUser-agent: HouseScannerPersonalReader\nDisallow: /sv/\n',
    );
    expect(robotsAllows(rules, '/sv/till_salu')).toBe(false);
  });

  it('allows the partition path and rejects unknown municipalities', () => {
    const url = new URL(partitionUrl('Göteborg') ?? '');
    expect(url.pathname).toBe(
      '/sv/till_salu/l%C3%A4genhet/v%C3%A4stra%20g%C3%B6talands/g%C3%B6teborg',
    );
    expect(robotsAllows(parseRobots(ROBOTS), url.pathname)).toBe(true);
    expect(partitionUrl('Malmö')).toBeNull();
  });
});
