# Feature: Parallel Task Execution with Git Worktrees in Main Extension Panel

> **Status:** RFC / Draft
> **Issue:** #5640
> **Author:** @Drilmo

## Overview

This document outlines the design for enabling parallel task execution with git worktrees in the main Kilo Code extension panel (ClineProvider).

## Problem Statement

Currently, the main sidebar panel executes tasks strictly sequentially:

- Users must wait for one task to complete before starting another
- Subtasks via orchestrator suspend the parent task
- No isolation between concurrent work streams

The Agent Manager already supports this capability, but it's a separate panel with a different UX.

## Goals

1. Enable parallel task execution in the main extension panel
2. Use git worktrees for isolation (like Agent Manager)
3. Allow users to switch between active tasks
4. Maintain backward compatibility with sequential execution

## Non-Goals

- Replacing the Agent Manager
- Automatic task parallelization (user-initiated only)
- Cross-task communication or coordination

## Technical Design

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    ClineProvider                         │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   Task 1    │  │   Task 2    │  │   Task 3    │     │
│  │ (main repo) │  │ (worktree1) │  │ (worktree2) │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│         │                │                │             │
│         ▼                ▼                ▼             │
│  ┌─────────────────────────────────────────────────┐   │
│  │              TaskManager (new)                   │   │
│  │  - Active tasks registry                         │   │
│  │  - Worktree management                           │   │
│  │  - Task switching                                │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. TaskManager (new)

- Manages multiple active Task instances
- Coordinates worktree creation/cleanup
- Handles task switching in UI

#### 2. WorktreeManager (reuse from Agent Manager)

- Already implements git worktree operations
- Can be shared between Agent Manager and main panel

#### 3. Modified ClineProvider

- Replace `clineStack` with `TaskManager`
- Add UI for task switching
- Support "background" task mode

### UI Changes

1. **Task Tabs/List**: Show all active tasks with status
2. **New Task Button**: Option to start in parallel (new worktree) or sequential
3. **Task Switcher**: Quick switch between active tasks
4. **Merge Assistant**: Help merge worktree branches when tasks complete

### Migration Path

1. Phase 1: Extract WorktreeManager to shared location
2. Phase 2: Create TaskManager abstraction
3. Phase 3: Add UI components for parallel tasks
4. Phase 4: Implement task switching and state management

## Open Questions

- [ ] How to handle rate limiting across parallel tasks?
- [ ] Should parallel mode be opt-in or default?
- [ ] How to visualize multiple active tasks in the sidebar?
- [ ] What happens to parallel tasks on extension restart?

## References

- Agent Manager implementation: `src/core/kilocode/agent-manager/`
- WorktreeManager: `src/core/kilocode/agent-manager/WorktreeManager.ts`
- ClineProvider: `src/core/webview/ClineProvider.ts`
