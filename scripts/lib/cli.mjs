// Small helpers shared by the CLIs. Keys come only from environment variables
// (GitHub secrets); they are never read from or written to the repository.
import { readFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { out[argv[i].slice(2)] = argv[i + 1]; i++; } else out._.push(argv[i]);
  }
  return out;
}

export const loadTrust = path => JSON.parse(readFileSync(path, 'utf8')).keys || [];

export function keyFromEnv(name) {
  const pem = process.env[name];
  if (!pem) { console.error(`missing ${name}`); process.exit(2); }
  return createPrivateKey(pem);
}

// Decisions only: never bundle content.
export function report(obj) { console.log(JSON.stringify(obj)); }
