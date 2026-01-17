# Core - Checkpoints Feature

**Quick Navigation for AI Agents**

---

## Overview

Task checkpoint and restore system. Saves task state at key points, enabling rollback to previous states.

**Source Location**: `src/core/checkpoints/`

---

## Components

| Component | Type | File |
|-----------|------|------|
| Checkpoints | Module | `index.ts` |
| seeNewChanges | Function | `kilocode/seeNewChanges.ts` |

---

## Quick Reference

| Operation | Method | File |
|-----------|--------|------|
| Create checkpoint | `createCheckpoint()` | `index.ts` |
| Restore checkpoint | `restoreCheckpoint()` | `index.ts` |
| List checkpoints | `listCheckpoints()` | `index.ts` |

---

## How It Works

1. **Save**: Capture task state at checkpoint
2. **Store**: Persist checkpoint data
3. **Restore**: Reload task to checkpoint state

---

## Related

- [Services Checkpoints](../../../services/features/checkpoints/) - Checkpoint service implementations
- [Task](../task/) - Tasks create checkpoints

---

[← Back to Core](../../Feature-Index.md)
