# Services - Auto-Purge Feature

**Quick Navigation for AI Agents**

---

## Overview

Automatic cleanup service. Removes old conversations, checkpoints, and temporary data to manage storage.

**Source Location**: `src/services/auto-purge/`

---

## Components

| Component | Type | File |
|-----------|------|------|
| AutoPurgeService | Class | `AutoPurgeService.ts` |
| AutoPurgeScheduler | Class | `AutoPurgeScheduler.ts` |

---

## Quick Reference

| Operation | Method |
|-----------|--------|
| Run purge | `purge()` |
| Schedule purge | `schedule()` |
| Configure rules | `configure()` |

---

## Purge Rules

What gets purged:
- Old task histories (based on age)
- Unused checkpoints
- Temporary files
- Cache data

---

## Configuration

| Setting | Description |
|---------|-------------|
| maxAge | Maximum age before purge |
| maxCount | Maximum items to keep |
| excludePatterns | Patterns to exclude |

---

## Related

- [Task](../../../core/features/task/) - Task data that may be purged
- [Checkpoints](../checkpoints/) - Checkpoint data

---

[← Back to Services](../../Feature-Index.md)
