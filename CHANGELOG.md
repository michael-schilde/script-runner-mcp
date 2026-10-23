# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-23

### Added

- Config-driven tools: program, optional script, argument templates and typed parameters.
- Parameter types `string`, `path`, `integer` and `enum`, with path containment (symlinks resolved), extension filters and option-injection guard.
- Shell-free execution with timeout and output cap; failures reported as MCP tool errors.
- Dependency-free MCP stdio transport with protocol version negotiation, and a `--check` CLI flag.
