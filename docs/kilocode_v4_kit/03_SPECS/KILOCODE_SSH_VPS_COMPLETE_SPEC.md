# SSH and VPS Complete Coverage Spec

Version: 1.0.0
Status: Draft
Last updated: 2026-04-17

---

## 1. SSH Profile Schema

File: `config/ssh/profiles.yaml`

```yaml
# profiles.yaml — one entry per managed SSH host
profiles:
  - id: string                   # UUID v4, immutable after creation
    label: string                # Human-readable display name (1-64 chars)
    host: string                 # Hostname or IPv4/IPv6 address
    port: integer                # 1-65535, default 22
    username: string             # Remote login user
    authMethod: enum             # "key" | "password"
    keyPath: string | null       # Absolute path to private key file (required when authMethod=key)
    passphrase: string | null    # Reference to encrypted secret: "secret://<vault-key-id>"
                                 # Never stored in plaintext. Resolved at connect time via
                                 # VS Code SecretStorage or system keychain.
    jumpHost: string | null      # Profile id of the jump/bastion host. Must reference an
                                 # existing profile id in this file. Circular refs are a
                                 # validation error.
    group: string | null         # Host group id (see section 2)
    tags: string[]               # Freeform labels for filtering, max 16 tags, each 1-32 chars
    connectTimeout: integer      # Milliseconds, default 10000, range 1000-120000
    keepAliveInterval: integer   # Milliseconds, default 15000, range 0 (disabled) to 60000
```

### Validation rules

| Field | Rule | Error on violation |
|---|---|---|
| id | Must be unique across all profiles | `SSH_PROFILE_DUPLICATE_ID` |
| host | Must pass hostname or IP regex | `SSH_PROFILE_INVALID_HOST` |
| port | 1-65535 | `SSH_PROFILE_INVALID_PORT` |
| keyPath (when authMethod=key) | File must exist and be readable | `SSH_KEY_INVALID` |
| jumpHost | Must reference existing profile id, no cycles | `SSH_PROFILE_JUMP_CYCLE` |
| passphrase | Must be a `secret://` URI or null | `SSH_PROFILE_BAD_SECRET_REF` |

---

## 2. Host Group Model

File: `config/ssh/groups.yaml`

```yaml
groups:
  - id: string           # UUID v4, immutable
    label: string         # Display name, 1-48 chars
    color: string         # Hex color "#RRGGBB" used in sidebar/tree badges
    profiles: string[]    # Ordered list of profile ids belonging to this group
```

### Constraints

- A profile may belong to at most one group. If `profile.group` is set, that profile id must appear in the corresponding group's `profiles[]` array. Mismatch is a validation warning, auto-corrected on load by trusting the profile's `group` field.
- Deleting a group sets `group: null` on all member profiles.
- Groups with zero members are allowed (empty placeholder).
- Maximum 64 groups.

---

## 3. Connection State Machine

```
                    +--------------+
                    | disconnected |<---------+
                    +------+-------+          |
                           |                  |
                     connect()                |
                           |                  |
                    +------v-------+          |
                    |  connecting  |---timeout-+  (connectTimeout ms)
                    +------+-------+          |
                           |                  |
                   socket open                |
                           |                  |
                    +------v---------+        |
                    | authenticating |--fail---+
                    +------+---------+        |
                           |                  |
                    auth success              |
                           |                  |
                    +------v-------+          |
               +--->|  connected   |          |
               |    +------+-------+          |
               |           |                  |
               |    connection drop           |
               |           |                  |
               |    +------v---------+        |
               +----| reconnecting   |--max---+
                    +----------------+  retries
```

### Timeouts and limits

| Parameter | Default | Range | Notes |
|---|---|---|---|
| connectTimeout | 10 000 ms | 1 000 - 120 000 | Per profile, per attempt |
| authTimeout | 15 000 ms | 5 000 - 60 000 | Time allowed for auth handshake after socket open |
| reconnectDelay | 2 000 ms | 500 - 30 000 | Delay before first reconnect attempt |
| reconnectBackoff | exponential x2 | -- | 2s, 4s, 8s, 16s, capped at 30s |
| maxReconnectAttempts | 5 | 0 - 20 | 0 disables auto-reconnect |
| keepAliveInterval | 15 000 ms | 0 - 60 000 | 0 disables keep-alive packets |
| keepAliveCountMax | 3 | 1 - 10 | Missed keep-alives before declaring dead |

### State transition events

| From | To | Trigger | Side effects |
|---|---|---|---|
| disconnected | connecting | User action or auto-connect on workspace open | Start TCP socket |
| connecting | authenticating | TCP handshake complete | Begin SSH handshake |
| connecting | disconnected | `connectTimeout` exceeded | Emit `SSH_TIMEOUT`, log |
| authenticating | connected | Auth success | Open default channel, start keepalive timer |
| authenticating | disconnected | Auth failure | Emit `SSH_AUTH_FAILED` or `SSH_KEY_INVALID` |
| connected | reconnecting | Socket error, EOF, or keepalive failure | Cancel in-flight SFTP ops, snapshot terminal state |
| reconnecting | connected | Reconnect handshake success | Restore terminal session, resume SFTP queue |
| reconnecting | disconnected | `maxReconnectAttempts` exhausted | Emit `SSH_HOST_UNREACHABLE`, clean up |

---

## 4. Terminal Session Model

```yaml
terminalSession:
  sessionId: string         # UUID v4, created on shell open
  profileId: string         # FK to SSH profile
  pty:
    cols: integer            # Default 80, range 20-500
    rows: integer            # Default 24, range 5-200
  scrollbackBufferSize: integer  # Lines, default 10000, range 1000-100000
  encoding: string           # Default "utf-8", allowed: "utf-8", "latin1", "ascii"
  shellPath: string | null   # Override remote shell, e.g. "/bin/zsh". null = server default.
  env: object                # Key-value pairs injected into remote env. Max 32 entries.
  createdAt: string          # ISO 8601
  lastActivity: string       # ISO 8601, updated on any I/O
  state: enum                # "active" | "suspended" | "closed"
```

### Lifecycle

1. **open** -- Allocate PTY on the remote host via the connected SSH channel. Generate `sessionId`. Set `state=active`.
2. **resize** -- Client sends new `cols`/`rows`. Server adjusts PTY window. No new session.
3. **suspend** -- On VS Code window blur or explicit suspend. Mark `state=suspended`. Keep channel open. Stop rendering but keep buffering output up to `scrollbackBufferSize`.
4. **resume** -- Render buffered output. Set `state=active`.
5. **close** -- Send EOF to remote PTY. Deallocate channel. Set `state=closed`. Session record retained for 24 hours for log export, then pruned.

---

## 5. SFTP Operations

All operations require `state=connected` on the parent SSH connection. Operations are queued; max 4 concurrent SFTP requests per connection.

### 5.1 list

List directory contents.

| Field | Type | Notes |
|---|---|---|
| **Request** | | |
| path | string | Absolute remote path |
| showHidden | boolean | Include dotfiles, default false |
| **Response** | | |
| entries[] | object | Array of `{name, type, size, mtime, permissions}` |
| entries[].type | enum | "file", "directory", "symlink", "other" |
| **Errors** | | |
| SFTP_NOT_FOUND | | Path does not exist |
| SFTP_PERMISSION_DENIED | | User lacks read permission on directory |

### 5.2 stat

Get metadata for a single path.

| Field | Type | Notes |
|---|---|---|
| **Request** | | |
| path | string | Absolute remote path |
| **Response** | | |
| size | integer | Bytes |
| mtime | string | ISO 8601 |
| atime | string | ISO 8601 |
| permissions | string | Octal string, e.g. "0644" |
| owner | string | Username |
| group | string | Group name |
| type | enum | "file", "directory", "symlink", "other" |
| **Errors** | | |
| SFTP_NOT_FOUND | | Path does not exist |

### 5.3 read

Download file contents.

| Field | Type | Notes |
|---|---|---|
| **Request** | | |
| path | string | Absolute remote path |
| offset | integer | Byte offset, default 0 |
| length | integer | Max bytes to read. -1 = entire file. Default -1. |
| **Response** | | |
| data | Buffer | Raw file bytes |
| bytesRead | integer | Actual bytes returned |
| **Errors** | | |
| SFTP_NOT_FOUND | | File does not exist |
| SFTP_PERMISSION_DENIED | | User lacks read permission |

### 5.4 write

Upload or overwrite file contents.

| Field | Type | Notes |
|---|---|---|
| **Request** | | |
| path | string | Absolute remote path |
| data | Buffer | Bytes to write |
| flags | enum | "overwrite" (truncate+write), "append", "create_new" (fail if exists) |
| mode | string | Octal permissions for new files, default "0644" |
| **Response** | | |
| bytesWritten | integer | |
| **Errors** | | |
| SFTP_PERMISSION_DENIED | | User lacks write permission |
| SFTP_QUOTA_EXCEEDED | | Disk quota or partition full |
| SFTP_NOT_FOUND | | Parent directory does not exist (for create_new) |

### 5.5 mkdir

Create directory.

| Field | Type | Notes |
|---|---|---|
| **Request** | | |
| path | string | Absolute remote path |
| recursive | boolean | Create parents, default false |
| mode | string | Octal, default "0755" |
| **Response** | | |
| created | boolean | |
| **Errors** | | |
| SFTP_PERMISSION_DENIED | | |
| SFTP_QUOTA_EXCEEDED | | |

### 5.6 rm

Remove file or directory.

| Field | Type | Notes |
|---|---|---|
| **Request** | | |
| path | string | Absolute remote path |
| recursive | boolean | Required true for non-empty directories |
| **Response** | | |
| removed | boolean | |
| **Errors** | | |
| SFTP_NOT_FOUND | | |
| SFTP_PERMISSION_DENIED | | |

### 5.7 rename

Move or rename a file/directory.

| Field | Type | Notes |
|---|---|---|
| **Request** | | |
| oldPath | string | |
| newPath | string | |
| overwrite | boolean | If false and newPath exists, error. Default false. |
| **Response** | | |
| renamed | boolean | |
| **Errors** | | |
| SFTP_NOT_FOUND | | oldPath does not exist |
| SFTP_PERMISSION_DENIED | | |

### 5.8 chmod

Change file permissions.

| Field | Type | Notes |
|---|---|---|
| **Request** | | |
| path | string | |
| mode | string | Octal, e.g. "0755" |
| **Response** | | |
| applied | boolean | |
| **Errors** | | |
| SFTP_NOT_FOUND | | |
| SFTP_PERMISSION_DENIED | | |

---

## 6. Remote Edit Flow

Sequence for opening, editing, and saving a remote file through the KiloCode editor.

```
User clicks file       SFTP read          Local buffer         User edits
in remote tree  ------> fetch  ---------> created      ------> text
      (1)                (2)               (3)                 (4)

                                                          User saves
                                                             |
                                                             v
                                                      Compute diff (5)
                                                             |
                                                             v
                                                   Show diff panel (6)
                                                             |
                                                     +-------+-------+
                                                     |               |
                                                  Confirm          Cancel
                                                     |               |
                                                     v               v
                                              SFTP write (7)    Discard diff
                                                     |
                                                     v
                                              SFTP stat (8)
                                              verify checksum
                                                     |
                                                     v
                                              Update buffer
                                              mark clean (9)
```

### Step details

| Step | Action | Failure behavior |
|---|---|---|
| 1. open | User selects file in remote file tree panel | N/A |
| 2. fetch | `SFTP.read(path)`. Store remote mtime + SHA-256 checksum. | Show `SFTP_NOT_FOUND` or `SFTP_PERMISSION_DENIED` in notification. |
| 3. local buffer | Write to temp dir: `{tmpDir}/kilo-remote/{profileId}/{path}`. Open in VS Code editor tab. | Disk write error shown in notification. |
| 4. edit | Standard VS Code editing. Buffer is marked dirty. | N/A |
| 5. diff | Compute unified diff between original fetch content and current buffer. | If remote file changed since fetch (mtime/checksum mismatch on pre-check), show conflict dialog with three-way merge option. |
| 6. confirm | Show diff panel. User reviews additions/deletions. Buttons: "Apply", "Cancel", "Edit more". | N/A |
| 7. upload | `SFTP.write(path, bufferContent, flags="overwrite")`. | On `SFTP_PERMISSION_DENIED`: notification + keep buffer dirty. On `SFTP_QUOTA_EXCEEDED`: notification + keep buffer dirty. On connection loss: queue for retry after reconnect. |
| 8. verify | `SFTP.stat(path)` + `SFTP.read(path, 0, 64)`. Compare size and first-64-byte prefix against uploaded content. | Mismatch triggers warning: "Remote file does not match upload. Re-upload?" |
| 9. clean | Mark buffer as not-dirty. Update stored mtime/checksum to new values. | N/A |

### Conflict resolution

When step 5 detects a remote change since fetch:

1. Fetch the new remote version.
2. Show three-pane view: **Remote (theirs)** | **Base (original fetch)** | **Local (yours)**.
3. User merges manually.
4. On save, repeat from step 5 with the merged content as the new buffer.

---

## 7. Error Codes

| Code | HTTP | Meaning | Retryable | User-facing message |
|---|---|---|---|---|
| `SSH_AUTH_FAILED` | -- | Username/password rejected or keyboard-interactive failed | No | "Authentication failed. Check username and password." |
| `SSH_HOST_UNREACHABLE` | -- | TCP connection refused or DNS resolution failed | Yes (after delay) | "Cannot reach host. Verify hostname and network." |
| `SSH_TIMEOUT` | -- | `connectTimeout` or `authTimeout` elapsed | Yes | "Connection timed out." |
| `SSH_KEY_INVALID` | -- | Private key file unreadable, wrong format, or passphrase wrong | No | "SSH key is invalid or passphrase is incorrect." |
| `SSH_PERMISSION_DENIED` | -- | Server rejected channel open or exec request | No | "Permission denied by remote host." |
| `SSH_KEEPALIVE_DEAD` | -- | `keepAliveCountMax` missed responses | Yes (reconnect) | "Connection lost. Reconnecting..." |
| `SSH_JUMP_FAILED` | -- | Jump host connection failed before reaching target | Depends on cause | "Jump host connection failed: {inner_error}." |
| `SSH_PROFILE_NOT_FOUND` | -- | Requested profile id does not exist in profiles.yaml | No | "SSH profile not found." |
| `SFTP_NOT_FOUND` | -- | Remote path does not exist | No | "File or directory not found on remote host." |
| `SFTP_PERMISSION_DENIED` | -- | Insufficient remote filesystem permissions | No | "Permission denied on remote file." |
| `SFTP_QUOTA_EXCEEDED` | -- | Remote disk quota or partition full | No | "Remote disk full or quota exceeded." |
| `SFTP_TRANSFER_INTERRUPTED` | -- | Read/write aborted mid-stream (connection drop) | Yes (after reconnect) | "Transfer interrupted. Will retry after reconnect." |

---

## 8. VPS Inventory Schema

File: `config/vps/inventory.yaml`

```yaml
inventory:
  - id: string               # UUID v4
    label: string             # Display name, 1-64 chars
    provider: enum            # "aws" | "gcp" | "azure" | "hetzner" | "custom"
    region: string            # Provider region code, e.g. "us-east-1", "eu-central-1"
    ip: string                # Public IPv4 or IPv6 address
    privateIp: string | null  # Private/VPC IP if applicable
    os: string                # OS identifier, e.g. "ubuntu-22.04", "debian-12", "rocky-9"
    cpu: integer              # vCPU count
    ram: integer              # RAM in MB
    disk: integer             # Root disk in GB
    status: enum              # "running" | "stopped" | "unreachable" | "provisioning" | "unknown"
    services:                 # Named services running on this VPS
      - name: string          # e.g. "nginx", "postgres", "redis"
        port: integer         # Listening port
        status: enum          # "running" | "stopped" | "failed" | "unknown"
        managedBy: enum       # "systemd" | "docker" | "manual"
    sshProfileId: string      # FK to SSH profile id for connecting to this VPS
    notes: string | null      # Freeform text, max 512 chars
    addedAt: string           # ISO 8601
    lastSeen: string          # ISO 8601, updated on successful connect or poll
```

### Provider-specific fields

When `provider` is not "custom", additional metadata may be stored under an optional `providerMeta` key:

```yaml
    providerMeta:
      instanceId: string      # e.g. "i-0abcdef1234567890" (AWS)
      instanceType: string    # e.g. "t3.medium", "e2-standard-2"
      tags: object            # Provider-level tags as key-value pairs
```

---

## 9. Monitoring Data Model

Polling interval: configurable, default 30 seconds, range 10-300 seconds. Data retained locally for 24 hours (rolling window, max 2880 samples per metric at 30s interval).

```yaml
monitoringSample:
  vpsId: string           # FK to inventory id
  timestamp: string       # ISO 8601 with milliseconds
  cpu:
    usagePercent: number   # 0.0 - 100.0
    loadAvg1m: number      # 1-minute load average
    loadAvg5m: number      # 5-minute load average
    coreCount: integer     # For context
  ram:
    usedBytes: integer     # Bytes in use
    totalBytes: integer    # Total physical RAM
    usagePercent: number   # 0.0 - 100.0
    swapUsedBytes: integer
    swapTotalBytes: integer
  disk:
    - mountPoint: string   # e.g. "/" or "/data"
      usedBytes: integer
      totalBytes: integer
      usagePercent: number # 0.0 - 100.0
      fsType: string       # e.g. "ext4", "xfs"
  network:
    rxBytesPerSec: integer
    txBytesPerSec: integer
  uptime: integer          # Seconds since last boot
```

### Collection method

Metrics are gathered by executing a single command over the existing SSH session:

```bash
# Executed on remote host, output is JSON parsed client-side
cat /proc/stat /proc/meminfo /proc/uptime && df --output=target,used,avail,fstype -B1 && cat /proc/net/dev
```

If the command fails (e.g., restricted shell), the sample is recorded with `null` values for the failing subsystem and a `collection_error` field is set.

---

## 10. Docker Integration

Requires Docker CLI available on the remote host. All commands are executed over the SSH terminal channel. The UI reflects results; KiloCode does not install Docker.

### 10.1 Container operations

| Operation | Remote command | Response shape | Error handling |
|---|---|---|---|
| list | `docker ps -a --format '{{json .}}'` | `{id, names, image, status, state, ports, created}[]` | If Docker not installed: show "Docker not found" badge on VPS. |
| inspect | `docker inspect <id>` | Full Docker inspect JSON | `DOCKER_NOT_FOUND` if container id does not exist. |
| logs | `docker logs --tail <n> --timestamps <id>` | Raw log text streamed to output panel | `DOCKER_NOT_FOUND` |
| start | `docker start <id>` | `{id, state: "running"}` | Already running: no-op, return current state. |
| stop | `docker stop -t <timeout> <id>` | `{id, state: "exited"}` | Already stopped: no-op. |
| restart | `docker restart -t <timeout> <id>` | `{id, state: "running"}` | Follows stop+start semantics. |
| remove | `docker rm <id>` | `{id, removed: true}` | Running container: error unless force=true (`docker rm -f`). |

### 10.2 Image operations

| Operation | Remote command | Response shape |
|---|---|---|
| list | `docker images --format '{{json .}}'` | `{id, repository, tag, size, created}[]` |
| pull | `docker pull <image>:<tag>` | Stream pull progress to output panel |
| remove | `docker rmi <id>` | `{id, removed: true}` |

### 10.3 Compose operations

| Operation | Remote command | Notes |
|---|---|---|
| up | `docker compose -f <file> up -d` | Detached mode always. `<file>` defaults to `docker-compose.yml` in cwd. |
| down | `docker compose -f <file> down` | Stops and removes containers, networks. Volumes preserved unless `--volumes` flag. |
| ps | `docker compose -f <file> ps --format json` | List compose project services. |
| logs | `docker compose -f <file> logs --tail <n> --timestamps` | Streamed to output panel. |

### 10.4 Approval gates

| Action | Risk | Gate |
|---|---|---|
| list, inspect, logs, ps | read-only | None |
| start, restart, pull | side-effect | Confirmation toast ("Start container X?") |
| stop, remove, down | destructive | Modal confirmation with container/service name displayed |

---

## 11. Config Paths

| File | Purpose | Format |
|---|---|---|
| `config/ssh/profiles.yaml` | SSH connection profiles | YAML (see section 1) |
| `config/ssh/groups.yaml` | Host groups | YAML (see section 2) |
| `config/vps/inventory.yaml` | VPS inventory | YAML (see section 8) |
| `config/ssh/known_hosts` | Cached host key fingerprints | OpenSSH `known_hosts` format |
| `data/ssh/sessions/` | Terminal session logs (one file per sessionId) | Binary + metadata JSON sidecar |
| `data/monitoring/` | Monitoring sample store | SQLite or JSONL, one file per VPS id |

All paths are relative to the KiloCode data directory (`~/.kilocode/` on Linux/macOS, `%APPDATA%\kilocode\` on Windows). Paths are resolved at startup; missing directories are created automatically with `0700` permissions.

---

## Acceptance Criteria

### AC-1: Connect to host from saved profile

| Condition | Pass | Fail |
|---|---|---|
| Profile with `authMethod=key` and valid key file | SSH session reaches `connected` state within `connectTimeout` | Any state other than `connected` after timeout |
| Profile with `authMethod=password` and correct password | SSH session reaches `connected` state | `SSH_AUTH_FAILED` emitted |
| Profile with invalid host | `SSH_HOST_UNREACHABLE` emitted within `connectTimeout` | Silent failure or hang |
| Profile with jump host | Connection established through jump host, both hops logged | Jump host failure not surfaced to user |

### AC-2: Browse remote file tree

| Condition | Pass | Fail |
|---|---|---|
| Connected session, valid path | `SFTP.list()` returns entries displayed in tree view | Empty tree with no error shown |
| Path does not exist | `SFTP_NOT_FOUND` shown in notification | Crash or silent empty tree |
| No read permission | `SFTP_PERMISSION_DENIED` shown | Hang or partial render |
| Large directory (10 000+ entries) | Paginated load, UI responsive within 2 seconds | UI freeze > 3 seconds |

### AC-3: Open, edit, and save remote file

| Condition | Pass | Fail |
|---|---|---|
| Edit and save a text file | Diff shown, user confirms, file uploaded, verify step passes | File saved without diff shown |
| Remote file changed since fetch | Conflict dialog with three-pane merge | Silent overwrite of remote changes |
| Save fails (permission) | `SFTP_PERMISSION_DENIED` notification, buffer stays dirty | Buffer marked clean despite failed save |
| Connection drops during save | Queued for retry after reconnect, user notified | Data lost silently |

### AC-4: Show diff before apply

| Condition | Pass | Fail |
|---|---|---|
| Any file edit triggers save | Unified diff panel opens before upload | Direct upload without diff |
| No changes made (accidental save) | Diff panel shows "No changes", Apply button disabled | Empty diff uploaded |
| Binary file edit | Warning: "Binary diff not supported. Overwrite?" | Diff panel shows garbage |

### AC-5: Tail logs

| Condition | Pass | Fail |
|---|---|---|
| `docker logs --follow <id>` over SSH | Live output streamed to output panel | Stream ends prematurely with no error |
| Container does not exist | `DOCKER_NOT_FOUND` notification | Crash or silent failure |
| Connection drop during tail | Reconnect, resume tail with gap indicator | Silent stop |

### AC-6: Restart a service with approval

| Condition | Pass | Fail |
|---|---|---|
| User clicks restart on a Docker container | Modal confirmation, then `docker restart` executed | Restart without confirmation |
| User clicks restart on a systemd service | Modal confirmation, then `systemctl restart <name>` executed | Restart without confirmation |
| User cancels confirmation | No action taken, service state unchanged | Service restarted despite cancel |

### AC-7: Inspect remote containers

| Condition | Pass | Fail |
|---|---|---|
| Docker installed on remote | Container list populated in VPS detail panel | "Docker not found" shown incorrectly |
| Docker not installed | "Docker not found" badge on VPS card, no crash | Crash or repeated error toasts |
| Container inspect | Full JSON rendered in read-only editor tab | Truncated or malformed output |

### AC-8: Failure paths are visible and logged

| Condition | Pass | Fail |
|---|---|---|
| Any error code in section 7 | Error notification shown with user-facing message, full error logged to output channel "KiloCode SSH" | Error swallowed silently |
| Reconnect attempts | Status bar shows "Reconnecting (attempt 2/5)..." | No indication of reconnect in progress |
| Final reconnect failure | Status bar shows "Disconnected", notification with "Reconnect" action button | Stuck in "Reconnecting" state indefinitely |
