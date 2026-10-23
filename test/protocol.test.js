import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.js';
import { SUPPORTED_PROTOCOL_VERSIONS, handleMessage } from '../src/protocol.js';
import { exampleDir } from './helpers.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });

function config() {
  return loadConfig(path.join(exampleDir(), 'config.example.json'));
}

test('initialize negotiates the protocol version', async () => {
  const cfg = config();
  const known = await handleMessage(cfg, rpc(1, 'initialize', { protocolVersion: '2024-11-05' }));
  assert.equal(known.result.protocolVersion, '2024-11-05');
  const unknown = await handleMessage(cfg, rpc(2, 'initialize', { protocolVersion: '1999-01-01' }));
  assert.equal(unknown.result.protocolVersion, SUPPORTED_PROTOCOL_VERSIONS[0]);
});

test('notifications get no response, unknown methods an error', async () => {
  const cfg = config();
  assert.equal(await handleMessage(cfg, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal((await handleMessage(cfg, rpc(3, 'resources/list'))).error.code, -32601);
  assert.equal((await handleMessage(cfg, { id: 4, method: 'ping' })).error.code, -32600);
  assert.deepEqual((await handleMessage(cfg, rpc(5, 'ping'))).result, {});
});

test('tools/list exposes a closed input schema', async () => {
  const { result } = await handleMessage(config(), rpc(6, 'tools/list'));
  const [tool] = result.tools;
  assert.equal(tool.name, 'count_words');
  assert.deepEqual(tool.inputSchema.required, ['file']);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.equal(tool.inputSchema.properties.top.maximum, 50);
});

test('tools/call rejects bad arguments without running anything', async () => {
  let ran = false;
  const fakeRun = async () => {
    ran = true;
    return { ok: true, stdout: '' };
  };
  const res = await handleMessage(config(), rpc(7, 'tools/call', { name: 'count_words', arguments: { file: '../x' } }), fakeRun);
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /^Rejected:/);
  assert.equal(ran, false);

  const unknown = await handleMessage(config(), rpc(8, 'tools/call', { name: 'rm', arguments: {} }), fakeRun);
  assert.equal(unknown.result.isError, true);
});

test('end to end over stdio', async () => {
  const configPath = path.join(exampleDir(), 'config.example.json');
  const child = spawn(process.execPath, [CLI, '--config', configPath], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout });
  const responses = new Map();
  const waiters = new Map();
  lines.on('line', (line) => {
    const msg = JSON.parse(line);
    responses.set(msg.id, msg);
    waiters.get(msg.id)?.(msg);
  });
  const call = (id, method, params) =>
    new Promise((resolve) => {
      waiters.set(id, resolve);
      child.stdin.write(`${JSON.stringify(rpc(id, method, params))}\n`);
    });

  await call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const res = await call(2, 'tools/call', { name: 'count_words', arguments: { file: 'sample.txt', top: 2 } });
  child.stdin.end();

  assert.equal(res.result.isError, undefined);
  assert.match(res.result.content[0].text, /^lines: 3, words: 17/);
  assert.match(res.result.content[0].text, /the: 2/);
  await new Promise((resolve) => child.on('exit', resolve));
});
