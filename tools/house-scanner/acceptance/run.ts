import { type CheckResult, runChecks } from './checks';
import {
  type AcceptanceConfig,
  parseArgs,
  parseEnv,
  secretsOf,
} from './config';
import { createSupabaseGateway, type Gateway } from './gateway';
import { formatTable, hasFailure, jsonReport, makeRedactor } from './report';
import { seedSql } from './seed-sql';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  writeFile(path: string, text: string): void;
}

/** 0 all checks passed or skipped, 1 a check failed, 2 refused or bad input. */
export type RunCode = 0 | 1 | 2;

export async function runAcceptance(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: Io,
  makeGateway: (config: AcceptanceConfig) => Gateway = createSupabaseGateway,
): Promise<RunCode> {
  const args = parseArgs(argv);
  if (!args.ok) {
    io.stderr(args.error);
    return 2;
  }
  if (args.value.printSeedSql) {
    io.stdout(seedSql());
    return 0;
  }
  if (!args.value.confirmHosted) {
    io.stderr(
      'Refusing to run without --confirm-hosted. This script signs in and writes test favorites and notes to the project in HS_ACCEPT_URL.',
    );
    return 2;
  }
  const config = parseEnv(env);
  if (!config.ok) {
    io.stderr(config.error);
    return 2;
  }
  const redact = makeRedactor(secretsOf(config.value));
  const results: CheckResult[] = await runChecks(
    makeGateway(config.value),
    {
      a2Provided: config.value.users.A2 !== undefined,
      a2Deactivated: args.value.a2Deactivated,
    },
    redact,
  );
  io.stdout(redact(formatTable(results)));
  if (args.value.out) {
    const report = jsonReport(results, config.value.local ? 'local' : 'hosted');
    io.writeFile(
      args.value.out,
      `${redact(JSON.stringify(report, null, 2))}\n`,
    );
    io.stdout('JSON report written to the --out path.');
  }
  return hasFailure(results) ? 1 : 0;
}
