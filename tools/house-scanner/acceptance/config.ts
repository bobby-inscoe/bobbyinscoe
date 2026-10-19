// Everything the script reads from outside: environment variables and flags.
// Secrets come only from the environment. Nothing here ever echoes a value;
// errors name the variable or flag, never its content.

export const USER_LABELS = ['A', 'A2', 'B'] as const;
export type UserLabel = (typeof USER_LABELS)[number];

export interface AcceptanceConfig {
  url: string;
  publishableKey: string;
  users: Partial<Record<UserLabel, { email: string; password: string }>>;
  local: boolean;
}

export interface CliOptions {
  confirmHosted: boolean;
  printSeedSql: boolean;
  a2Deactivated: boolean;
  out: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseArgs(argv: readonly string[]): Parsed<CliOptions> {
  const options: CliOptions = {
    confirmHosted: false,
    printSeedSql: false,
    a2Deactivated: false,
    out: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--confirm-hosted') options.confirmHosted = true;
    else if (arg === '--print-seed-sql') options.printSeedSql = true;
    else if (arg === '--a2-deactivated') options.a2Deactivated = true;
    else if (arg === '--out') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--'))
        return { ok: false, error: '--out needs a file path.' };
      options.out = value;
      i += 1;
    } else return { ok: false, error: 'Unknown argument.' };
  }
  return { ok: true, value: options };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function parseEnv(
  env: Readonly<Record<string, string | undefined>>,
): Parsed<AcceptanceConfig> {
  const raw = env.HS_ACCEPT_URL?.trim();
  const key = env.HS_ACCEPT_PUBLISHABLE_KEY?.trim();
  if (!raw) return { ok: false, error: 'HS_ACCEPT_URL is not set.' };
  if (!key)
    return { ok: false, error: 'HS_ACCEPT_PUBLISHABLE_KEY is not set.' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'HS_ACCEPT_URL is not a valid URL.' };
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  const hosted = url.hostname.endsWith('.supabase.co');
  if (url.username || url.password || url.search || url.hash)
    return {
      ok: false,
      error: 'HS_ACCEPT_URL must be a bare project URL.',
    };
  if (!hosted && !local)
    return {
      ok: false,
      error: 'HS_ACCEPT_URL must be a *.supabase.co host or localhost.',
    };
  if (hosted && url.protocol !== 'https:')
    return { ok: false, error: 'A hosted project URL must use https.' };
  if (local && !['http:', 'https:'].includes(url.protocol))
    return { ok: false, error: 'HS_ACCEPT_URL must use http or https.' };
  if (key.startsWith('sb_secret_') || !key.startsWith('sb_publishable_'))
    return {
      ok: false,
      error:
        'HS_ACCEPT_PUBLISHABLE_KEY must be a publishable key (sb_publishable_...). Never use a secret or service key here.',
    };
  const users: AcceptanceConfig['users'] = {};
  for (const label of USER_LABELS) {
    const email = env[`HS_ACCEPT_${label}_EMAIL`]?.trim();
    const password = env[`HS_ACCEPT_${label}_PASSWORD`];
    if (!email && !password) continue;
    if (!email || !password)
      return {
        ok: false,
        error: `Set both HS_ACCEPT_${label}_EMAIL and HS_ACCEPT_${label}_PASSWORD, or neither.`,
      };
    users[label] = { email, password };
  }
  for (const required of ['A', 'B'] as const)
    if (!users[required])
      return {
        ok: false,
        error: `HS_ACCEPT_${required}_EMAIL and HS_ACCEPT_${required}_PASSWORD are required.`,
      };
  return {
    ok: true,
    value: { url: url.origin, publishableKey: key, users, local },
  };
}

// Values that must never reach stdout, the report or an error message.
export function secretsOf(config: AcceptanceConfig): string[] {
  const values = [config.publishableKey, config.url, new URL(config.url).host];
  for (const user of Object.values(config.users))
    if (user) values.push(user.email, user.password);
  return values.filter((value) => value.length > 0);
}
