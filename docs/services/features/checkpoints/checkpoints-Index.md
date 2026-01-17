# Services - Checkpoints Feature

**Quick Navigation for AI Agents**

---

## Overview

Checkpoint service implementations. Provides different strategies for saving and restoring task state.

**Source Location**: `src/services/checkpoints/`

---

## Components

| Component | Type | File |
|-----------|------|------|
| RepoPerTaskCheckpointService | Class | `RepoPerTaskCheckpointService.ts` |
| ShadowCheckpointService | Class | `ShadowCheckpointService.ts` |
| excludes | Config | `excludes.ts` |

---

## Checkpoint Strategies

### RepoPerTaskCheckpointService

Creates git repository per task for version control.

**Features**:
- Git-based checkpoints
- Full history tracking
- Diff capabilities

### ShadowCheckpointService

Shadow copy-based checkpoints.

**Features**:
- File-based snapshots
- Fast save/restore
- Lower overhead

---

## Quick Reference

| Operation | Method |
|-----------|--------|
| Save checkpoint | `save()` |
| Restore checkpoint | `restore()` |
| List checkpoints | `list()` |
| Get diff | `diff()` |

---

## Excludes

Files excluded from checkpoints:
- `node_modules/`
- `.git/`
- Build outputs
- Large binary files

---

## Related

- [Core Checkpoints](../../../core/features/checkpoints/) - Checkpoint logic
- [Task](../../../core/features/task/) - Uses checkpoint service

---

[← Back to Services](../../Feature-Index.md)
