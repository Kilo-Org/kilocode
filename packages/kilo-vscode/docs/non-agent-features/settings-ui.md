# Settings UI

**GitHub Issue:** [#170](https://github.com/Kilo-Org/kilo/issues/170)
**Priority:** P1
**Status:** 🔨 Partial

## Description

Replicate the settings that are available in OpenCode (CLI) and allow users to customize them through the VS Code extension UI.

## Requirements

- Settings UI that mirrors OpenCode's configuration options
- Organized into logical tabs/sections
- Settings persist and sync with CLI configuration
- Changes take effect immediately or with clear save/apply semantics
- Include all major setting categories: providers, models, behaviour, display, etc.

## Current State

14 tabs are functional: Providers (model selection + allow/block lists), AgentBehaviour (MCP read-only, rules, skills), AutoApprove (per-tool allow/ask/deny dropdowns), Browser, Autocomplete, Display, Notifications, Context, Terminal, Prompts, Experimental, Language, AboutKiloCode.

## Gaps

- Workflows subtab inside AgentBehaviour is a `<Placeholder>` (not implemented)
- No import/export settings functionality
