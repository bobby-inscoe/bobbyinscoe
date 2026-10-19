import { writeFileSync } from 'node:fs';

import { runAcceptance } from './run';

try {
  const code = await runAcceptance(process.argv.slice(2), process.env, {
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    writeFile: (path, text) => writeFileSync(path, text, 'utf8'),
  });
  process.exitCode = code;
} catch {
  // No error text on purpose: it could carry a request URL or a credential.
  process.stderr.write('Acceptance script stopped on an unexpected error.\n');
  process.exitCode = 2;
}
