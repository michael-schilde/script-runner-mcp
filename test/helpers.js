import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');

// Copy the shipped example into a fresh temp folder so tests can add files.
export function exampleDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'script-runner-'));
  cpSync(EXAMPLES, dir, { recursive: true });
  return dir;
}
