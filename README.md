# script-runner-mcp

[![CI](https://github.com/michael-schilde/script-runner-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/michael-schilde/script-runner-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent run the local scripts you declared, and nothing else. Arguments are checked before anything starts, and no shell is involved.

## Why this exists

My agents work inside a Linux sandbox. Some jobs need the host machine instead. One example is rendering branded images with Puppeteer: the sandbox has no Chrome, no root and no way to download one. The render scripts worked fine on the host, but the agent could not reach them.

So the agent improvised. It drew title images with Pillow, and they came out off-brand. A rule in its instructions saying "never render with Pillow" didn't stop it, because from the agent's point of view a workaround still beat failing the task.

The fix was to give it a proper path: a small MCP server on the host that exposes the render scripts as tools. The first version hard-coded two script paths. This is the general version. You declare each script, its arguments and the parameters the agent may fill in, and the agent gets exactly those tools. There is no generic "run command" tool.

## How it works

- **Declared tools only.** A JSON config lists each tool: the program (`node` by default), an optional script, an argument template and typed parameters.
- **Checked parameters.** `path` parameters must resolve, after following symlinks, inside one of the `allowed_roots` and can be limited to certain extensions. `integer` parameters have ranges, `enum` parameters have fixed values, and `string` parameters have a length limit, an optional pattern and must not start with `-`, so they cannot smuggle in options. Unknown arguments are rejected.
- **No shell.** The process starts via `execFile` with `shell: false`, so `&&`, `$(...)` or `;` in an argument stay plain text.
- **Bounded runs.** Each tool has a timeout. Output is capped. A failure comes back as an MCP tool error with exit code and stderr.
- **Zero runtime dependencies.** It speaks JSON-RPC over stdio directly in about 500 lines of plain Node.js, so there is little to audit.

## Installation

You need Node.js 22 or newer.

```bash
npx -y github:michael-schilde/script-runner-mcp --config path/to/config.json --check
```

`--check` validates the config and prints the tools it would expose. Then register the server with your MCP client, for example in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "script-runner": {
      "command": "npx",
      "args": ["-y", "github:michael-schilde/script-runner-mcp", "--config", "/absolute/path/to/config.json"]
    }
  }
}
```

You can also clone the repository and point the client at `node /path/to/script-runner-mcp/src/cli.js`. Instead of `--config` you can set the `SCRIPT_RUNNER_CONFIG` environment variable.

## Example: a Puppeteer render script

```json
{
  "allowed_roots": ["./images"],
  "tools": [
    {
      "name": "render_title_image",
      "description": "Renders a 1200x630 title image from a JSON spec and prints the PNG path.",
      "script": "./render/render.js",
      "args": ["{spec}"],
      "params": {
        "spec": { "type": "path", "required": true, "extensions": [".json"], "description": "Image spec" }
      },
      "timeout_ms": 120000
    }
  ]
}
```

The agent sees one tool, `render_title_image`, with one argument. A spec outside `./images`, a `.js` file or an extra argument is rejected before Node starts.

A runnable demo lives in [`examples/`](examples): `count_words` counts the words of a text file inside `examples/content`.

## Configuration

Relative paths are resolved against the folder that contains the config file.

| Key | Meaning |
|:--|:--|
| `allowed_roots` | Folders that `path` parameters must stay inside |
| `tools[].name` | Tool name (`a-z`, `0-9`, `_`) |
| `tools[].description` | Shown to the agent |
| `tools[].command` | `node` (default, the Node binary running the server), a program on `PATH`, or a path to an executable |
| `tools[].script` | Optional script passed as the first argument |
| `tools[].args` | Argument templates; `{param}` is replaced by the checked value. An argument that refers to an omitted optional parameter is dropped, so write optional flags as `--flag={param}` |
| `tools[].params` | Parameters the agent may pass (see below) |
| `tools[].cwd` | Working directory (default: the config folder) |
| `tools[].timeout_ms` | Timeout, default 60000, max 600000 |
| `tools[].env` | Extra environment variables for the process |

| Parameter rule | Meaning |
|:--|:--|
| `type` | `string` (default), `path`, `integer` or `enum` |
| `required`, `default` | Whether the agent must pass it, and the value used when it does not |
| `description` | Shown to the agent |
| `pattern`, `maxlen` | `string`: regex and maximum length (default 1000) |
| `min`, `max` | `integer`: range |
| `values` | `enum`: allowed values |
| `extensions` | `path`: allowed file extensions, e.g. `[".json"]` |
| `must_exist` | `path`: default `true`; set `false` for output files, whose parent folder must still exist |

## Limits

- **The script is trusted.** The server controls what the agent may pass in, not what your script does with it. A script that runs `eval` on its input is still dangerous.
- **Inherited environment.** Child processes get the server's environment plus `env`, so tools like Puppeteer find their caches. Do not put secrets in the server's environment if your scripts should not see them.
- **No `.cmd` or `.bat` on Windows.** Without a shell, Node cannot start batch files. Point `command` at a real executable (`node`, `python`, `.exe`).
- **Tools only.** The server implements `initialize`, `ping`, `tools/list` and `tools/call`. It has no resources, prompts, progress notifications or cancellation, and a long run just waits for its timeout.
- **Platforms.** I use it on Windows. CI runs the tests on Linux and Windows.

## Development

```bash
npm install
npm test
npm run lint
```

## About

I built this with [Claude Code](https://claude.com/claude-code). It grew out of the render bridge in my own agent setup. Issues and pull requests are welcome.

## License

[MIT](LICENSE) © Michael Schilde
