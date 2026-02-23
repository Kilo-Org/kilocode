# Rules & Workflows

**Priority:** P3
**Status:** ❌ Not started

## Description

Support for rules and workflows. Rules define constraints and guidelines for the AI agent. Workflows define multi-step automated processes.

## Requirements

- View and manage rules (project-level, user-level, global)
- Create/edit/delete rules via the extension UI
- View and manage workflows
- Rules are applied to agent sessions automatically
- UI for browsing `.kilocode/rules/` and similar rule sources

## Current State

No rules or workflow UI exists. The CLI backend supports rules (AGENTS.md, .kilocode/rules/).

## Gaps

- No rules management UI
- No workflow definition or execution UI
- Need to determine CLI endpoints for rules CRUD
- Need to determine workflow format and execution model
- Related to [Custom Commands](custom-command-system.md) and [Skills System](skills-system.md)
