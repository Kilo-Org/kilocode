# Core - Agent Manager Feature

**Quick Navigation for AI Agents**

---

## Overview

Kilocode-specific agent management system. Manages CLI processes, parallel execution, git worktrees, and remote sessions. The AgentManagerProvider (67KB) is one of the largest files in the codebase.

**Source Location**: `src/core/kilocode/agent-manager/`

---

## Components

| Component | Type | File | Size |
|-----------|------|------|------|
| AgentManagerProvider | Class | `AgentManagerProvider.ts` | 67KB |
| CliProcessHandler | Class | `CliProcessHandler.ts` | 35KB |
| CliSessionLauncher | Class | `CliSessionLauncher.ts` | - |
| CliPathResolver | Class | `CliPathResolver.ts` | 13KB |
| CliOutputParser | Class | `CliOutputParser.ts` | 9KB |
| CliModelsFetcher | Class | `CliModelsFetcher.ts` | - |
| CliInstaller | Class | `CliInstaller.ts` | - |
| CliArgsBuilder | Class | `CliArgsBuilder.ts` | - |
| WorktreeManager | Class | `WorktreeManager.ts` | 12KB |
| WorkspaceGitService | Class | `WorkspaceGitService.ts` | - |
| RemoteSessionService | Class | `RemoteSessionService.ts` | - |
| SessionTerminalManager | Class | `SessionTerminalManager.ts` | - |

---

## Documentation Files

- **[AgentManagerProvider.md](./AgentManagerProvider.md)** - Main provider class
- **[CliProcessHandler.md](./CliProcessHandler.md)** - CLI process management
- **[WorktreeManager.md](./WorktreeManager.md)** - Git worktree management
- **[ParallelMode.md](./ParallelMode.md)** - Parallel execution

---

## Quick Reference

| Operation | Method | File |
|-----------|--------|------|
| Create agent | `createAgent()` | `AgentManagerProvider.ts` |
| Launch CLI | `launchCli()` | `CliSessionLauncher.ts` |
| Handle process | `handleProcess()` | `CliProcessHandler.ts` |
| Parse output | `parseOutput()` | `CliOutputParser.ts` |
| Create worktree | `createWorktree()` | `WorktreeManager.ts` |
| Run parallel | `runParallel()` | `parallelModeParser.ts` |

---

## Architecture

```
AgentManagerProvider (67KB)
    ├── CliSessionLauncher
    │   ├── CliArgsBuilder
    │   └── CliPathResolver
    ├── CliProcessHandler (35KB)
    │   └── CliOutputParser
    ├── WorktreeManager (12KB)
    │   └── WorkspaceGitService
    └── RemoteSessionService
        └── SessionTerminalManager
```

---

## Utility Files

| File | Purpose |
|------|---------|
| `parallelModeParser.ts` | Parse parallel execution modes |
| `providerEnvMapper.ts` | Map provider environment variables |
| `normalizeGitUrl.ts` | URL normalization |
| `multiVersionUtils.ts` | Multi-version support |
| `mapUtils.ts` | Map utilities |
| `askErrorParser.ts` | Parse ask errors |
| `telemetry.ts` | Agent telemetry |
| `ShellOutput.ts` | Shell output handling |
| `KilocodeEventProcessor.ts` | Process kilocode events |

---

## Key Concepts

- **Agent**: CLI instance running Kilocode tasks
- **Worktree**: Git worktree for parallel work
- **Session**: Active agent session
- **Parallel Mode**: Run multiple agents simultaneously

---

[← Back to Core](../../Feature-Index.md)
