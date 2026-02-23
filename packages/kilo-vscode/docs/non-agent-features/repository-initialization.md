# Repository Initialization

**Priority:** P3
**Status:** ❌ Not started

## Description

Support for the `/init` command — initialize a repository for agentic engineering. This sets up the project with appropriate configuration files, rules, and conventions for working with Kilo Code.

## Requirements

- Command or button to initialize a repository
- Creates appropriate configuration files (e.g., AGENTS.md, .kilocode/ directory)
- Detects existing project structure and tailors initialization
- May scaffold rules, workflows, or skill configurations
- Should be accessible from VS Code command palette and/or chat UI

## Current State

No initialization support exists in the extension. The CLI supports `/init`.

## Gaps

- No init command registered in the extension
- No UI for triggering initialization
- Need to determine if this calls a CLI endpoint or replicates CLI logic
- No progress/status feedback during initialization
