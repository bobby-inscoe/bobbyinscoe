const ROBOTS_TOKEN = 'housescannerpersonalreader';

export interface RobotsRules {
  rules: { allow: boolean; pattern: RegExp; length: number }[];
}

export function parseRobots(body: string): RobotsRules {
  type Group = { agents: string[]; rules: [boolean, string][] };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      if (!lastWasAgent || current === null) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if ((field === 'allow' || field === 'disallow') && current && value !== '')
      current.rules.push([field === 'allow', value]);
  }
  const named = groups.filter((group) =>
    group.agents.some((agent) => agent !== '*' && ROBOTS_TOKEN.includes(agent)),
  );
  const chosen = named.length
    ? named
    : groups.filter((group) => group.agents.includes('*'));
  return {
    rules: chosen.flatMap((group) =>
      group.rules.map(([allow, raw]) => {
        const anchored = raw.endsWith('$');
        const source = (anchored ? raw.slice(0, -1) : raw)
          .split('*')
          .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*');
        return {
          allow,
          pattern: new RegExp(`^${source}${anchored ? '$' : ''}`),
          length: raw.replace(/\*/g, '').length,
        };
      }),
    ),
  };
}

export function robotsAllows(robots: RobotsRules, pathAndQuery: string) {
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of robots.rules) {
    if (!rule.pattern.test(pathAndQuery)) continue;
    if (
      best === null ||
      rule.length > best.length ||
      (rule.length === best.length && rule.allow)
    )
      best = rule;
  }
  return best === null || best.allow;
}
