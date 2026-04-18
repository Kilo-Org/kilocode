# Memory Complete Coverage Spec

Version: 1.0.0
Config path: `config/memory.yaml`

---

## 1. Shiba Connection Model

Shiba is the memory backend service. The connection is managed as a persistent WebSocket with automatic reconnection.

```typescript
interface ShibaConnection {
  endpoint: string;                // e.g. "wss://shiba.kilocode.internal/v1/ws"
  authToken: string;               // JWT, sourced from SHIBA_AUTH_TOKEN env
  connectionState: "connected" | "disconnected" | "reconnecting";
  lastPing: string;                // ISO-8601 timestamp of last successful ping
  lastPong: string;                // ISO-8601 timestamp of last received pong
  reconnectAttempts: number;       // current count since last disconnect
  maxRetries: number;              // from config, default 10
  reconnectBackoff: {
    initial_ms: number;            // 1000
    max_ms: number;                // 30000
    multiplier: number;            // 2.0
  };
  latency_ms: number;              // rolling average of recent ping-pong RTT
}
```

### Connection Config (in `config/memory.yaml`)

```yaml
shiba:
  endpoint: wss://shiba.kilocode.internal/v1/ws
  auth:
    token_env: SHIBA_AUTH_TOKEN
    token_refresh_before_expiry_seconds: 300
  connection:
    ping_interval_seconds: 15
    pong_timeout_seconds: 5
    max_retries: 10
    reconnect_backoff:
      initial_ms: 1000
      max_ms: 30000
      multiplier: 2.0
  timeouts:
    write_ms: 5000
    read_ms: 3000
    batch_ms: 15000
```

### Connection State Machine

```
DISCONNECTED ──(connect())──→ CONNECTING
CONNECTING ──(handshake success)──→ CONNECTED
CONNECTING ──(handshake failure)──→ RECONNECTING
CONNECTED ──(pong timeout)──→ RECONNECTING
CONNECTED ──(server close)──→ RECONNECTING
RECONNECTING ──(attempt < maxRetries, backoff elapsed)──→ CONNECTING
RECONNECTING ──(attempts >= maxRetries)──→ DISCONNECTED [emit MEM_CONNECTION_LOST]
```

---

## 2. Memory Entry Schema

Every piece of stored memory is a `MemoryEntry`.

```typescript
interface MemoryEntry {
  entry_id: string;            // UUID v4
  project_id: string;          // which project this belongs to (or "__global__")
  agent_id: string;            // which agent wrote it, e.g. "zeroclaw", "kilocode-core"
  scope: "global" | "project" | "session";
  key: string;                 // dot-separated path, e.g. "user.preferences.theme"
  value: unknown;              // any JSON-serializable value
  value_type: "string" | "number" | "boolean" | "object" | "array";
  created_at: string;          // ISO-8601
  updated_at: string;          // ISO-8601
  accessed_at: string;         // ISO-8601, updated on every read
  access_count: number;        // incremented on every read
  ttl: number | null;          // seconds until auto-expiry, null = permanent
  expires_at: string | null;   // computed from ttl, null = never
  tags: string[];              // freeform labels, e.g. ["preference", "auto-learned"]
  checksum: string;            // SHA-256 of JSON.stringify(value), for integrity checks
  size_bytes: number;          // byte size of serialized value
  version: number;             // incremented on every write, starts at 1
}
```

### Storage Limits

```yaml
limits:
  max_entry_size_bytes: 65536       # 64 KB per entry
  max_entries_per_project: 10000
  max_entries_global: 5000
  max_total_storage_bytes: 104857600  # 100 MB
  max_tags_per_entry: 20
  max_key_length: 256
```

---

## 3. Recall Request / Response

### Recall Request

```typescript
interface RecallRequest {
  query: string;                // natural language or exact key match
  scope: "global" | "project" | "session" | "all";
  project_id: string | null;   // required if scope is "project"
  agent_id: string | null;     // filter by writing agent; null = all agents
  max_results: number;          // default 10, max 100
  min_relevance: number;        // 0.0 to 1.0, default 0.5
  tags_filter: string[];        // optional; entries must have ALL listed tags
  include_expired: boolean;     // default false
  sort_by: "relevance" | "recency" | "access_count";
}
```

### Recall Response

```typescript
interface RecallResponse {
  entries: RecallResult[];
  total_matches: number;        // total entries matching (before max_results cap)
  search_time_ms: number;
  query_interpreted: string;    // how the system parsed the query
  scope_searched: string;
  truncated: boolean;           // true if total_matches > max_results
}

interface RecallResult {
  entry: MemoryEntry;
  relevance_score: number;      // 0.0 to 1.0
  match_reason: string;         // e.g. "exact key match", "semantic similarity"
}
```

---

## 4. Write Operation

### Write Request

```typescript
interface MemoryWriteRequest {
  project_id: string;
  agent_id: string;
  scope: "global" | "project" | "session";
  key: string;
  value: unknown;
  tags: string[];
  ttl: number | null;
  conflict_resolution: "last_write_wins" | "merge" | "reject_if_exists";
}
```

### Write Response

```typescript
interface MemoryWriteResponse {
  entry_id: string;
  status: "created" | "updated" | "merged" | "rejected";
  version: number;              // new version after write
  previous_version: number | null;
  conflict_detected: boolean;
  merge_details: string | null; // if conflict_resolution was "merge"
  timestamp: string;
}
```

### Conflict Resolution Strategies

| Strategy            | Behavior                                                                                     |
|---------------------|----------------------------------------------------------------------------------------------|
| `last_write_wins`   | Overwrites existing entry unconditionally. Increments version. Default strategy.             |
| `merge`             | Deep-merges objects (new keys added, existing keys updated). Arrays are concatenated and deduplicated. Scalars use last-write. |
| `reject_if_exists`  | Returns `status: "rejected"` if the key already exists in the given scope. No mutation.      |

### Write Queueing

When `connectionState != "connected"`, writes are queued locally:

```typescript
interface QueuedWrite {
  write_request: MemoryWriteRequest;
  queued_at: string;
  retry_count: number;
  max_retries: 5;
  status: "queued" | "retrying" | "failed";
}
```

Queue is drained FIFO when connection is restored. Entries that exceed `max_retries` emit `MEM_WRITE_FAILED` and are moved to `data/memory/dead_letter.jsonl`.

---

## 5. Project-Scoped Memory

### Isolation Model

Memory entries are namespaced to prevent cross-project leakage.

**Namespace format:** `project:{project_id}:{key}`

Examples:
- `project:proj_abc123:build.last_successful`
- `project:proj_abc123:user.preferences.language`
- `__global__:system.version`

### Isolation Rules

1. An agent operating within project `proj_abc123` can only read/write entries with `project_id == "proj_abc123"` or `scope == "global"`.
2. `session`-scoped entries are further namespaced: `project:{project_id}:session:{session_id}:{key}`. They are auto-deleted when the session ends.
3. Global entries (`scope: "global"`) are readable by all agents in all projects but writable only by agents with `global_write` permission.
4. Project IDs must match `^[a-z0-9_-]{3,64}$`.

### Namespace Collision Prevention

Before writing, the system checks:
```
IF scope == "project" AND project_id is missing → reject with MEM_SCOPE_DENIED
IF scope == "global" AND agent lacks global_write permission → reject with MEM_SCOPE_DENIED
IF key conflicts with reserved prefix ("_system.", "_meta.") → reject with MEM_WRITE_FAILED
```

---

## 6. Cross-Agent Recall

### Permission Matrix

| Reader Agent    | global (read) | global (write) | own project | other project | session (own) | session (other) |
|-----------------|---------------|----------------|-------------|---------------|---------------|-----------------|
| kilocode-core   | yes           | yes            | yes         | yes           | yes           | no              |
| zeroclaw        | yes           | no             | yes         | no            | yes           | no              |
| worker-agent    | yes           | no             | yes         | no            | yes           | no              |
| external-plugin | yes           | no             | no          | no            | no            | no              |

### Permission Config

```yaml
permissions:
  kilocode-core:
    global_read: true
    global_write: true
    cross_project_read: true
    session_read_other: false
  zeroclaw:
    global_read: true
    global_write: false
    cross_project_read: false
    session_read_other: false
  worker-agent:
    global_read: true
    global_write: false
    cross_project_read: false
    session_read_other: false
  external-plugin:
    global_read: true
    global_write: false
    cross_project_read: false
    session_read_other: false
```

### Audit Trail

Every recall and write operation is logged:

```typescript
interface MemoryAuditEntry {
  audit_id: string;             // UUID v4
  timestamp: string;            // ISO-8601
  agent_id: string;             // who performed the operation
  operation: "read" | "write" | "delete" | "recall";
  scope: string;
  project_id: string;
  key: string | null;           // null for recall queries
  query: string | null;         // null for direct key access
  result: "allowed" | "denied";
  denial_reason: string | null; // e.g. "MEM_SCOPE_DENIED: cross_project_read not permitted"
  entry_ids_accessed: string[]; // which entries were read/written
  source_ip: string | null;
}
```

Audit log path: `data/memory/audit/YYYY-MM-DD.jsonl`
Retention: 180 days.

---

## 7. Memory Failure Paths

### Connection Lost Mid-Write

```
1. Write request issued while connectionState == "connected"
2. WebSocket drops before server ACK
3. Write is placed in local queue (QueuedWrite)
4. Reconnection begins (see Connection State Machine)
5. On reconnect: drain queue FIFO
6. Each queued write retries up to 5 times with exponential backoff
7. If all retries fail: emit MEM_WRITE_FAILED, move to dead_letter.jsonl
8. Caller receives async notification of failure
```

### Corrupted Entry

```
1. On read, compute SHA-256 of value and compare to stored checksum
2. If mismatch:
   a. Log MEM_ENTRY_CORRUPTED with entry_id, expected checksum, actual checksum
   b. Mark entry with flag corrupted: true
   c. Return entry to caller with warning: "integrity check failed"
   d. If a previous version exists (version > 1), offer rollback to last known-good
3. Corrupted entries are excluded from recall results by default
   (set include_corrupted: true to override)
```

### Recall Timeout

```
1. Recall request sent to Shiba
2. If response not received within timeouts.read_ms (3000ms):
   a. Check local cache for matching entries
   b. If cache hit: return cached results with warning "stale data; recall timed out"
   c. If no cache: return empty results with error MEM_RECALL_TIMEOUT
3. Log timeout event with query, scope, and latency
```

### Quota Exceeded

```
1. Before write, check:
   - entry count vs max_entries_per_project / max_entries_global
   - total storage vs max_total_storage_bytes
   - entry size vs max_entry_size_bytes
2. If any limit exceeded: reject with MEM_QUOTA_EXCEEDED
3. Response includes:
   - which limit was hit
   - current usage
   - limit value
   - suggestion (e.g. "delete expired entries" or "increase quota in config")
```

---

## 8. Error Codes

| Code                  | Description                                                     | Recovery                                                    |
|-----------------------|-----------------------------------------------------------------|-------------------------------------------------------------|
| MEM_CONNECTION_LOST   | WebSocket to Shiba disconnected after exhausting retries        | Check network, verify Shiba endpoint, restart connection    |
| MEM_WRITE_FAILED      | Write could not be persisted after all retries                  | Check dead_letter.jsonl, manually replay, verify Shiba      |
| MEM_RECALL_TIMEOUT    | Recall query exceeded read timeout                              | Retry, check Shiba load, increase timeout in config         |
| MEM_SCOPE_DENIED      | Agent attempted to access a scope it lacks permission for       | Check permission matrix, request elevated access            |
| MEM_ENTRY_CORRUPTED   | Checksum mismatch on a stored entry                             | Roll back to previous version or delete and re-write        |
| MEM_QUOTA_EXCEEDED    | Storage or entry count limit reached                            | Delete expired/unused entries, increase limits in config    |
| MEM_KEY_INVALID       | Key format does not match `^[a-zA-Z0-9_.:-]{1,256}$`           | Fix key format                                              |
| MEM_VALUE_TOO_LARGE   | Serialized value exceeds max_entry_size_bytes                   | Reduce value size or split across multiple entries          |
| MEM_AUTH_EXPIRED      | Shiba auth token expired and refresh failed                     | Rotate SHIBA_AUTH_TOKEN, check token refresh config         |

### Error Response Envelope

```typescript
interface MemoryError {
  error_code: string;           // from table above
  message: string;              // human-readable description
  agent_id: string;
  project_id: string | null;
  key: string | null;
  timestamp: string;
  details: Record<string, unknown>;  // code-specific context (e.g. usage stats for quota)
}
```

---

## 9. Config Path

Primary configuration: `config/memory.yaml`

```
config/
  memory.yaml              # Shiba connection, timeouts, limits, permissions
  memory.local.yaml        # local overrides (gitignored)
```

Environment variables referenced:
- `SHIBA_AUTH_TOKEN` -- JWT for Shiba WebSocket auth

Data paths:
- `data/memory/audit/YYYY-MM-DD.jsonl` -- audit trail
- `data/memory/dead_letter.jsonl` -- failed writes after retry exhaustion
- `data/memory/cache/` -- local recall cache (LRU, max 50MB)

---

## Acceptance Criteria

1. A successful write is visible in the write history panel with entry_id, key, scope, version, and timestamp.
2. A successful recall returns matching entries with relevance scores and is visible in the recall trace panel.
3. Connection state (connected/disconnected/reconnecting) is displayed in the Shiba connection panel and updates in real time.
4. When connection drops mid-write, the write is queued and replayed on reconnect. The queue depth is visible in the UI.
5. Cross-agent recall from an agent without permission returns `MEM_SCOPE_DENIED` and the denial is logged in the audit trail.
6. A corrupted entry (checksum mismatch) is flagged and excluded from default recall results.
7. Recall timeout returns cached results (if available) or an empty set with `MEM_RECALL_TIMEOUT` error.
8. Quota exceeded on write returns `MEM_QUOTA_EXCEEDED` with current usage and limit details.
