# Cloud Task Support

**Priority:** P2
**Status:** 🔨 Partial

## What Exists

- Read-only cloud session retrieval: `getCloudSessions()`, `getCloudSession()`, `importCloudSession()` HTTP methods
- `CloudSessionList` component showing paginated cloud sessions grouped by date with repo filtering
- Cloud session preview (read-only message display)
- Cloud session import (one-way import into local storage)
- "Cloud History" toolbar button in sidebar

## Remaining Work

- Upload/sync local sessions to cloud
- Real-time sync between devices
- Conflict resolution when sessions are modified on multiple devices
