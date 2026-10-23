// Load and validate the runner configuration.
//
// Every tool the agent can call is declared in one JSON file: which program
// runs, which arguments it gets, and which parameters the agent may fill in.
// Nothing else can be executed.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,40}$/;
const PARAM_TYPES = new Set(['string', 'path', 'integer', 'enum']);
const TOOL_KEYS = new Set(['name', 'description', 'command', 'script', 'args', 'params', 'cwd', 'timeout_ms', 'env']);
const PARAM_KEYS = new Set([
  'type', 'description', 'required', 'default', 'pattern', 'maxlen',
  'values', 'min', 'max', 'extensions', 'must_exist',
]);
const PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g;

export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 10 * 60_000;

export class ConfigError extends Error {}

export function loadConfig(configPath) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new ConfigError(`cannot read config ${configPath}: ${err.message}`);
  }
  return parseConfig(raw, path.dirname(path.resolve(configPath)));
}

export function parseConfig(raw, baseDir) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ConfigError('config must be a JSON object');
  }

  const roots = raw.allowed_roots ?? [];
  if (!Array.isArray(roots)) throw new ConfigError('allowed_roots must be a list');
  const allowedRoots = roots.map((r) => {
    const abs = path.resolve(baseDir, String(r));
    if (!isDir(abs)) throw new ConfigError(`allowed_roots: not an existing folder: ${abs}`);
    return abs;
  });

  if (!Array.isArray(raw.tools) || raw.tools.length === 0) {
    throw new ConfigError('config needs a non-empty "tools" list');
  }
  const tools = new Map();
  for (const spec of raw.tools) {
    const tool = parseTool(spec, baseDir, allowedRoots);
    if (tools.has(tool.name)) throw new ConfigError(`duplicate tool name: ${tool.name}`);
    tools.set(tool.name, tool);
  }
  return { allowedRoots, tools };
}

function parseTool(spec, baseDir, allowedRoots) {
  if (!spec || typeof spec !== 'object') throw new ConfigError('each tool must be an object');
  const where = `tools.${spec.name ?? '?'}`;
  if (!NAME_PATTERN.test(spec.name ?? '')) throw new ConfigError(`${where}: name must match ${NAME_PATTERN}`);

  const unknown = Object.keys(spec).filter((k) => !TOOL_KEYS.has(k));
  if (unknown.length) throw new ConfigError(`${where}: unknown keys ${unknown.join(', ')}`);

  // "node" means the Node binary that runs this server, so no PATH lookup.
  const command = spec.command ?? 'node';
  if (typeof command !== 'string' || !command) throw new ConfigError(`${where}.command must be a string`);
  const resolvedCommand = command === 'node' ? process.execPath : resolveIfRelative(baseDir, command);

  let script = null;
  if (spec.script !== undefined) {
    script = path.resolve(baseDir, String(spec.script));
    if (!isFile(script)) throw new ConfigError(`${where}.script not found: ${script}`);
  }

  const args = spec.args ?? [];
  if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
    throw new ConfigError(`${where}.args must be a list of strings`);
  }

  const params = new Map();
  for (const [pname, prules] of Object.entries(spec.params ?? {})) {
    params.set(pname, parseParam(`${where}.params.${pname}`, prules, allowedRoots));
  }
  for (const arg of args) {
    for (const [, ref] of arg.matchAll(PLACEHOLDER)) {
      if (!params.has(ref)) throw new ConfigError(`${where}.args uses undeclared parameter {${ref}}`);
    }
  }

  const timeoutMs = spec.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new ConfigError(`${where}.timeout_ms must be between 1 and ${MAX_TIMEOUT_MS}`);
  }

  const cwd = path.resolve(baseDir, String(spec.cwd ?? '.'));
  if (!isDir(cwd)) throw new ConfigError(`${where}.cwd is not an existing folder: ${cwd}`);

  const env = spec.env ?? {};
  if (typeof env !== 'object' || Array.isArray(env) || !Object.values(env).every((v) => typeof v === 'string')) {
    throw new ConfigError(`${where}.env must map names to strings`);
  }

  return {
    name: spec.name,
    description: String(spec.description ?? ''),
    command: resolvedCommand,
    script,
    args,
    params,
    cwd,
    timeoutMs,
    env,
  };
}

function parseParam(where, rules, allowedRoots) {
  if (!rules || typeof rules !== 'object') throw new ConfigError(`${where}: must be an object`);
  const unknown = Object.keys(rules).filter((k) => !PARAM_KEYS.has(k));
  if (unknown.length) throw new ConfigError(`${where}: unknown rules ${unknown.join(', ')}`);

  const type = rules.type ?? 'string';
  if (!PARAM_TYPES.has(type)) throw new ConfigError(`${where}.type must be one of ${[...PARAM_TYPES].join(', ')}`);
  if (type === 'path' && allowedRoots.length === 0) {
    throw new ConfigError(`${where}: path parameters need at least one entry in allowed_roots`);
  }
  if (type === 'enum' && (!Array.isArray(rules.values) || rules.values.length === 0)) {
    throw new ConfigError(`${where}.values must be a non-empty list`);
  }
  let pattern = null;
  if (rules.pattern !== undefined) {
    try {
      pattern = new RegExp(rules.pattern, 'u');
    } catch (err) {
      throw new ConfigError(`${where}.pattern is not a valid regex: ${err.message}`);
    }
  }
  return {
    type,
    description: String(rules.description ?? ''),
    required: Boolean(rules.required),
    default: rules.default,
    pattern,
    maxlen: rules.maxlen ?? 1000,
    values: rules.values ?? [],
    min: rules.min,
    max: rules.max,
    extensions: (rules.extensions ?? []).map((e) => e.toLowerCase()),
    mustExist: rules.must_exist ?? true,
  };
}

function resolveIfRelative(baseDir, command) {
  // A bare program name ("python") is looked up on PATH; anything with a
  // separator is treated as a path relative to the config file.
  return /[\\/]/.test(command) ? path.resolve(baseDir, command) : command;
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export { PLACEHOLDER };
