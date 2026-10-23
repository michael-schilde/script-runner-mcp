import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { loadConfig } from '../src/config.js';
import { ArgumentError, buildArgv, isInside, runProcess, validateArguments } from '../src/runner.js';
import { exampleDir } from './helpers.js';

function setup() {
  const dir = exampleDir();
  const config = loadConfig(path.join(dir, 'config.example.json'));
  return { dir, config, tool: config.tools.get('count_words') };
}

const rejects = (fn, pattern) => assert.throws(fn, (err) => err instanceof ArgumentError && pattern.test(err.message));

test('accepts a valid file inside the allowed root', () => {
  const { dir, config, tool } = setup();
  const values = validateArguments(tool, { file: 'sample.txt', top: 3 }, config.allowedRoots);
  assert.equal(values.get('file'), path.join(dir, 'content', 'sample.txt'));
  assert.equal(values.get('top'), '3');
});

test('rejects missing, unknown and wrongly typed arguments', () => {
  const { config, tool } = setup();
  rejects(() => validateArguments(tool, {}, config.allowedRoots), /file is required/);
  rejects(() => validateArguments(tool, { file: 'sample.txt', cmd: 'x' }, config.allowedRoots), /unknown arguments: cmd/);
  rejects(() => validateArguments(tool, { file: 'sample.txt', top: '3' }, config.allowedRoots), /must be an integer/);
  rejects(() => validateArguments(tool, { file: 'sample.txt', top: 99 }, config.allowedRoots), /<= 50/);
});

test('rejects paths outside the allowed root', () => {
  const { config, tool } = setup();
  rejects(() => validateArguments(tool, { file: '../scripts/word-count.js' }, config.allowedRoots), /outside|file type/);
  rejects(() => validateArguments(tool, { file: '../../../../etc/passwd.txt' }, config.allowedRoots), /does not exist|outside/);
});

test('rejects files outside the root even when the name looks fine', () => {
  const { dir, config, tool } = setup();
  writeFileSync(path.join(dir, 'secret.txt'), 'nope');
  rejects(() => validateArguments(tool, { file: path.join(dir, 'secret.txt') }, config.allowedRoots), /outside/);
});

test('rejects wrong extensions and missing files', () => {
  const { dir, config, tool } = setup();
  writeFileSync(path.join(dir, 'content', 'data.json'), '{}');
  rejects(() => validateArguments(tool, { file: 'data.json' }, config.allowedRoots), /file type/);
  rejects(() => validateArguments(tool, { file: 'nope.txt' }, config.allowedRoots), /does not exist/);
});

test('rejects a symlink that points out of the root', (t) => {
  const { dir, config, tool } = setup();
  writeFileSync(path.join(dir, 'outside.txt'), 'nope');
  try {
    symlinkSync(path.join(dir, 'outside.txt'), path.join(dir, 'content', 'link.txt'));
  } catch {
    t.skip('symlinks not permitted on this system');
    return;
  }
  rejects(() => validateArguments(tool, { file: 'link.txt' }, config.allowedRoots), /outside/);
});

test('string parameters cannot inject options', () => {
  const tool = { params: new Map([['title', { type: 'string', maxlen: 20, required: true, pattern: null }]]) };
  rejects(() => validateArguments(tool, { title: '--help' }, []), /must not start with "-"/);
  rejects(() => validateArguments(tool, { title: 'x'.repeat(21) }, []), /longer than 20/);
  assert.equal(validateArguments(tool, { title: 'a; rm -rf /' }, []).get('title'), 'a; rm -rf /');
});

test('buildArgv drops args of omitted optional parameters', () => {
  const { config, tool } = setup();
  const values = validateArguments(tool, { file: 'sample.txt' }, config.allowedRoots);
  assert.deepEqual(buildArgv(tool, values), [tool.script, values.get('file')]);
  const withTop = validateArguments(tool, { file: 'sample.txt', top: 2 }, config.allowedRoots);
  assert.deepEqual(buildArgv(tool, withTop).slice(-1), ['--top=2']);
});

test('runProcess passes shell syntax through as plain text', async () => {
  const { dir } = setup();
  mkdirSync(path.join(dir, 'bin'));
  const script = path.join(dir, 'bin', 'echo.js');
  writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)));');
  const tool = { command: process.execPath, cwd: dir, timeoutMs: 5000, env: {} };
  const out = await runProcess(tool, [script, 'a && echo pwned', '$(whoami)']);
  assert.equal(out.ok, true);
  assert.deepEqual(JSON.parse(out.stdout), ['a && echo pwned', '$(whoami)']);
});

test('runProcess reports failures and timeouts', async () => {
  const tool = { command: process.execPath, cwd: process.cwd(), timeoutMs: 300, env: {} };
  const failed = await runProcess(tool, ['-e', 'console.error("boom"); process.exit(3)']);
  assert.equal(failed.ok, false);
  assert.equal(failed.exitCode, 3);
  assert.equal(failed.stderr, 'boom');

  const slow = await runProcess(tool, ['-e', 'setTimeout(() => {}, 5000)']);
  assert.equal(slow.timedOut, true);
});

test('isInside', () => {
  const root = path.resolve('/data/root');
  assert.equal(isInside(root, path.join(root, 'a', 'b.txt')), true);
  assert.equal(isInside(root, path.resolve('/data/root-other/x')), false);
  assert.equal(isInside(root, path.resolve('/data')), false);
});
