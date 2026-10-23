import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { ConfigError, loadConfig, parseConfig } from '../src/config.js';
import { exampleDir } from './helpers.js';

test('example config loads', () => {
  const dir = exampleDir();
  const config = loadConfig(path.join(dir, 'config.example.json'));
  const tool = config.tools.get('count_words');
  assert.equal(tool.command, process.execPath);
  assert.equal(tool.script, path.join(dir, 'scripts', 'word-count.js'));
  assert.deepEqual([...tool.params.keys()], ['file', 'top']);
});

const cases = [
  [{}, /non-empty "tools"/],
  [{ tools: [{ name: 'Bad Name' }] }, /name must match/],
  [{ tools: [{ name: 'a', shell: true }] }, /unknown keys shell/],
  [{ tools: [{ name: 'a', args: ['{nope}'] }] }, /undeclared parameter \{nope\}/],
  [{ tools: [{ name: 'a', params: { f: { type: 'path' } } }] }, /need at least one entry in allowed_roots/],
  [{ tools: [{ name: 'a', params: { f: { type: 'enum' } } }] }, /values must be a non-empty list/],
  [{ tools: [{ name: 'a', params: { f: { type: 'file' } } }] }, /type must be one of/],
  [{ tools: [{ name: 'a', timeout_ms: 0 }] }, /timeout_ms/],
  [{ tools: [{ name: 'a', script: './missing.js' }] }, /script not found/],
  [{ tools: [{ name: 'a' }, { name: 'a' }] }, /duplicate tool name/],
  [{ allowed_roots: ['./nowhere'], tools: [{ name: 'a' }] }, /not an existing folder/],
];

for (const [raw, message] of cases) {
  test(`rejects config: ${message}`, () => {
    assert.throws(() => parseConfig(raw, exampleDir()), (err) => err instanceof ConfigError && message.test(err.message));
  });
}
