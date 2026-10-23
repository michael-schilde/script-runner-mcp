// Turn validated tool arguments into a process call and run it.

import { execFile } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { PLACEHOLDER } from './config.js';

export const MAX_OUTPUT_CHARS = 50_000;

export class ArgumentError extends Error {}

// Check the agent's arguments against the declared parameters.
// Returns a Map of parameter name -> string value ready for the command line.
export function validateArguments(tool, args, allowedRoots) {
  const input = args ?? {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new ArgumentError('arguments must be an object');

  const unknown = Object.keys(input).filter((k) => !tool.params.has(k));
  if (unknown.length) throw new ArgumentError(`unknown arguments: ${unknown.join(', ')}`);

  const values = new Map();
  for (const [name, rules] of tool.params) {
    let value = input[name];
    if (value === undefined || value === null || value === '') {
      if (rules.required) throw new ArgumentError(`${name} is required`);
      if (rules.default === undefined) continue;
      value = rules.default;
    }
    values.set(name, checkValue(name, value, rules, allowedRoots));
  }
  return values;
}

function checkValue(name, value, rules, allowedRoots) {
  switch (rules.type) {
    case 'integer': {
      if (!Number.isInteger(value)) throw new ArgumentError(`${name} must be an integer`);
      if (rules.min !== undefined && value < rules.min) throw new ArgumentError(`${name} must be >= ${rules.min}`);
      if (rules.max !== undefined && value > rules.max) throw new ArgumentError(`${name} must be <= ${rules.max}`);
      return String(value);
    }
    case 'enum': {
      if (!rules.values.includes(value)) throw new ArgumentError(`${name} must be one of ${rules.values.join(', ')}`);
      return String(value);
    }
    case 'path':
      return checkPath(name, value, rules, allowedRoots);
    default: {
      if (typeof value !== 'string') throw new ArgumentError(`${name} must be a string`);
      if (value.length > rules.maxlen) throw new ArgumentError(`${name} is longer than ${rules.maxlen} characters`);
      if (rules.pattern && !rules.pattern.test(value)) throw new ArgumentError(`${name} does not match ${rules.pattern}`);
      // A leading dash would let the agent smuggle in options for the script.
      if (value.startsWith('-')) throw new ArgumentError(`${name} must not start with "-"`);
      return value;
    }
  }
}

function checkPath(name, value, rules, allowedRoots) {
  if (typeof value !== 'string' || !value) throw new ArgumentError(`${name} must be a path string`);
  // Relative paths are taken relative to the first allowed root.
  const candidate = path.resolve(allowedRoots[0], value);

  let real;
  try {
    real = realpathSync(candidate);
  } catch {
    if (rules.mustExist) throw new ArgumentError(`${name}: file does not exist`);
    // For outputs that do not exist yet, the folder they go into must.
    try {
      real = path.join(realpathSync(path.dirname(candidate)), path.basename(candidate));
    } catch {
      throw new ArgumentError(`${name}: parent folder does not exist`);
    }
  }

  if (!allowedRoots.some((root) => isInside(realpathSync(root), real))) {
    throw new ArgumentError(`${name}: path is outside the allowed folders`);
  }
  if (rules.extensions.length && !rules.extensions.includes(path.extname(real).toLowerCase())) {
    throw new ArgumentError(`${name}: file type must be one of ${rules.extensions.join(', ')}`);
  }
  if (rules.mustExist && !statSync(real).isFile()) throw new ArgumentError(`${name}: not a file`);
  return real;
}

export function isInside(root, target) {
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const rel = path.relative(norm(root), norm(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Build argv: script first (if any), then each declared arg with its
// placeholders filled in. An arg that refers to an omitted optional parameter
// is left out entirely.
export function buildArgv(tool, values) {
  const argv = tool.script ? [tool.script] : [];
  for (const template of tool.args) {
    const refs = [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
    if (refs.some((r) => !values.has(r))) continue;
    argv.push(template.replace(PLACEHOLDER, (_, ref) => values.get(ref)));
  }
  return argv;
}

// Run without a shell, so arguments are never interpreted as shell syntax.
export function runProcess(tool, argv) {
  return new Promise((resolve) => {
    execFile(
      tool.command,
      argv,
      {
        cwd: tool.cwd,
        timeout: tool.timeoutMs,
        env: { ...process.env, ...tool.env },
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        shell: false,
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          exitCode: err ? (typeof err.code === 'number' ? err.code : null) : 0,
          timedOut: Boolean(err?.killed && err.signal),
          spawnError: err && typeof err.code === 'string' ? `${err.code}: ${err.message}` : null,
          stdout: clip(String(stdout ?? '')),
          stderr: clip(String(stderr ?? '')),
        });
      },
    );
  });
}

function clip(text) {
  const t = text.trim();
  return t.length > MAX_OUTPUT_CHARS ? `${t.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]` : t;
}
