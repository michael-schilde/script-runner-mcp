# Security policy

Please report vulnerabilities privately through GitHub's [private vulnerability reporting](https://github.com/michael-schilde/script-runner-mcp/security/advisories/new) instead of opening a public issue. I will reply within a week.

This server starts processes on your machine on behalf of an AI agent. Argument validation and path containment (`allowed_roots`) are its security boundary, so reports about ways to run undeclared programs, inject options or reach files outside the allowed folders are especially welcome.
