#!/usr/bin/env node
// Entry point: read the config, then serve MCP over stdin/stdout.
// stdout carries protocol messages only; diagnostics go to stderr.

import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

import { ConfigError, loadConfig } from './config.js';
import { SERVER_INFO, handleMessage, toolDefinitions } from './protocol.js';

function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', default: process.env.SCRIPT_RUNNER_CONFIG },
      check: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
    },
  });

  if (values.version) {
    console.log(SERVER_INFO.version);
    return 0;
  }
  if (!values.config) {
    console.error('script-runner-mcp: pass --config <file> or set SCRIPT_RUNNER_CONFIG');
    return 2;
  }

  let config;
  try {
    config = loadConfig(values.config);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`script-runner-mcp: ${err.message}`);
      return 2;
    }
    throw err;
  }

  if (values.check) {
    for (const tool of toolDefinitions(config)) console.log(tool.name);
    return 0;
  }

  serve(config);
  return null;
}

function serve(config) {
  const rl = createInterface({ input: process.stdin, terminal: false });
  let pending = 0;
  let closed = false;
  const exitWhenIdle = () => {
    if (closed && pending === 0) process.exit(0);
  };

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    pending += 1;
    try {
      await handleLine(config, line);
    } finally {
      pending -= 1;
      exitWhenIdle();
    }
  });
  // Let running tools finish before exiting when the client closes stdin.
  rl.on('close', () => {
    closed = true;
    exitWhenIdle();
  });
}

async function handleLine(config, line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  try {
    const response = await handleMessage(config, msg);
    if (response) send(response);
  } catch (err) {
    console.error(err);
    send({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32603, message: 'Internal error' } });
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const code = main();
if (code !== null) process.exitCode = code;
