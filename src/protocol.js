// Minimal MCP (JSON-RPC 2.0 over stdio) handling: initialize, ping,
// tools/list and tools/call. No SDK, no runtime dependencies.

import { ArgumentError, buildArgv, runProcess, validateArguments } from './runner.js';

export const SERVER_INFO = { name: 'script-runner-mcp', version: '0.1.0' };
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export function toolDefinitions(config) {
  return [...config.tools.values()].map((tool) => {
    const properties = {};
    const required = [];
    for (const [name, rules] of tool.params) {
      const prop = { description: rules.description || undefined };
      if (rules.type === 'integer') Object.assign(prop, { type: 'integer', minimum: rules.min, maximum: rules.max });
      else if (rules.type === 'enum') Object.assign(prop, { type: 'string', enum: rules.values });
      else prop.type = 'string';
      if (rules.type === 'path') {
        const hint = rules.extensions.length ? ` (${rules.extensions.join(', ')})` : '';
        prop.description = `${rules.description || 'File path'}${hint}. Must lie inside the allowed folders.`;
      }
      if (rules.default !== undefined) prop.default = rules.default;
      properties[name] = JSON.parse(JSON.stringify(prop)); // drops undefined keys
      if (rules.required) required.push(name);
    }
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: { type: 'object', properties, required, additionalProperties: false },
    };
  });
}

// Handle one parsed JSON-RPC message. Resolves to a response object, or to
// null for notifications that need no answer.
export async function handleMessage(config, msg, run = runProcess) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') {
    return error(msg?.id ?? null, -32600, 'Invalid Request');
  }
  const { id, method, params } = msg;
  if (id === undefined) return null; // notification, e.g. notifications/initialized

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return result(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    }
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: toolDefinitions(config) });
    case 'tools/call':
      return result(id, await callTool(config, params ?? {}, run));
    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}

async function callTool(config, params, run) {
  const tool = config.tools.get(params.name);
  if (!tool) return toolError(`Unknown tool: ${params.name}`);

  let values;
  try {
    values = validateArguments(tool, params.arguments, config.allowedRoots);
  } catch (err) {
    if (err instanceof ArgumentError) return toolError(`Rejected: ${err.message}`);
    throw err;
  }

  const outcome = await run(tool, buildArgv(tool, values));
  if (outcome.ok) return { content: [{ type: 'text', text: outcome.stdout || '(no output)' }] };

  const reason = outcome.timedOut
    ? `timed out after ${tool.timeoutMs} ms`
    : outcome.spawnError ?? `exited with code ${outcome.exitCode}`;
  const details = [outcome.stderr, outcome.stdout].filter(Boolean).join('\n');
  return toolError(`${tool.name} failed: ${reason}${details ? `\n${details}` : ''}`);
}

const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const toolError = (text) => ({ content: [{ type: 'text', text }], isError: true });
