# Updater Local Parity — Portable kilo2 Preview Channel

Status: **Real local directory artifact updater and CLI integration verified on macOS arm64, including apply and rollback of the actual portable tree. No whole capability row closed.**

Sources & constraints:
- Parent steering (messages 78, 86, 92, 95): Implement real local artifact updates without mock JSON substitution; manifest integrity must deterministically digest actual staged files, relative paths, modes, and symlink targets before pointer switch; preserve binaries, executable modes, and relative links; reject escaping symlinks and non-regular special files; require current-owner non-group/world-writable install root, launcher, and state; refuse unsafe/malformed state explicitly (only ENOENT means absent); size check is unconditional; never overwrite existing build directories or live installs; archives remain explicitly unsupported pending safe tooling. Parent owns `commands.ts`/`tui-preview.ts` wiring and CLI acceptance.

---

## 1. Exact API & Manifest Contract

Exported from `packages/kilo-cli/src/updater.ts`:

```ts
export interface UpdateManifest {
  readonly channel: string
  readonly version: string
  readonly buildId: string
  readonly platform: string
  readonly sha256: string // Deterministic tree digest of staged artifact
  readonly sizeBytes: number // Total content bytes of regular files in artifact
  readonly url: string // Local path or file:// URI
  readonly releaseDate?: string
  readonly format?: "directory" | "tar.gz" | "tgz"
}

export interface UpdaterConfig {
  /** Explicit manifest URL or file:// URI. If absent and KILO_UPDATE_MANIFEST_URL is unset, updater remains inert. */
  readonly manifestUrl?: string
  /** Owned preview install root. If absent, discovered from KILO_PREVIEW_INSTALL_ROOT. */
  readonly installRoot?: string
  /** Current channel override. Defaults to "kilo2-internal". */
  readonly currentChannel?: string
  /** Current platform override for testing. Defaults to `${process.platform}-${process.arch}`. */
  readonly currentPlatform?: string
  /** Optional custom fetch implementation for loopback test fixtures. */
  readonly fetch?: typeof fetch
}

export type CheckResult =
  | { readonly status: "inert"; readonly reason: string }
  | {
      readonly status: "up-to-date"
      readonly currentBuildId: string
      readonly currentVersion?: string
      readonly channel: string
      readonly platform: string
    }
  | {
      readonly status: "update-available"
      readonly currentBuildId: string
      readonly currentVersion?: string
      readonly channel: string
      readonly platform: string
      readonly update: UpdateManifest
    }

export type ApplyResult =
  | { readonly status: "inert"; readonly reason: string }
  | {
      readonly status: "up-to-date"
      readonly currentBuildId: string
      readonly currentVersion?: string
      readonly channel: string
    }
  | {
      readonly status: "applied"
      readonly previousBuildId?: string
      readonly currentBuildId: string
      readonly version: string
      readonly restartRequired: true
    }

export type RollbackResult =
  | { readonly status: "inert"; readonly reason: string }
  | {
      readonly status: "rolled-back"
      readonly previousBuildId: string
      readonly currentBuildId: string
      readonly restartRequired: true
    }

export function checkForUpdate(options?: UpdaterConfig): Promise<CheckResult>
export function applyUpdate(options?: UpdaterConfig): Promise<ApplyResult>
export function rollbackUpdate(options?: UpdaterConfig): Promise<RollbackResult>
export function inspectInstalledBuild(installRoot: string): Promise<InstalledBuildInfo>
export function digestDirectoryTree(rootDir: string): Promise<{ sha256: string; totalBytes: number; entryCount: number; tuples: TreeTuple[] }>
export function scanDirectoryEntries(rootDir: string): Promise<void>
export function verifyOwnershipAndMode(targetPath: string, description: string): void

export const Updater = { check, apply, rollback, inspect, digest, scan }
```

### CLI Subcommand Mapping & Actual JSON Output (`commands.ts` / `tui-preview.ts`)
The parent CLI wiring in `tui-preview.ts` executes the action and emits formatted JSON directly to stdout:

- `kilo2 update --check` -> calls `checkForUpdate()`. Output:
  ```json
  {
    "status": "up-to-date",
    "currentBuildId": "build-0.1.0-abc",
    "currentVersion": "0.1.0-internal+abc",
    "channel": "kilo2-internal",
    "platform": "darwin-arm64"
  }
  ```
  Or when an update is available:
  ```json
  {
    "status": "update-available",
    "currentBuildId": "build-0.1.0-abc",
    "currentVersion": "0.1.0-internal+abc",
    "channel": "kilo2-internal",
    "platform": "darwin-arm64",
    "update": {
      "channel": "kilo2-internal",
      "version": "0.2.0-internal+def",
      "buildId": "0.2.0-def",
      "platform": "darwin-arm64",
      "sha256": "...",
      "sizeBytes": 12345,
      "url": "file:///path/to/app",
      "format": "directory"
    }
  }
  ```
- `kilo2 update` / `kilo2 update --apply` -> calls `applyUpdate()`. Output:
  ```json
  {
    "status": "applied",
    "previousBuildId": "0.1.0-abc",
    "currentBuildId": "0.2.0-def",
    "version": "0.2.0-internal+def",
    "restartRequired": true
  }
  ```
- `kilo2 update --rollback` -> calls `rollbackUpdate()`. Output:
  ```json
  {
    "status": "rolled-back",
    "previousBuildId": "0.1.0-abc",
    "currentBuildId": "0.2.0-def",
    "restartRequired": true
  }
  ```
- If inert (unconfigured manifest URL or install root):
  ```json
  {
    "status": "inert",
    "reason": "Update manifest URL is not configured (KILO_UPDATE_MANIFEST_URL is unset)"
  }
  ```

---

## 2. Architecture & Review Corrections

### 1. Pure Directory Payload Staging (No HTTP JSON Fixtures)
- HTTP JSON fixture transport was completely removed per review.
- Payloads are staged exclusively from verified directory artifacts via `file://` URIs or absolute filesystem paths using Node's `cp(sourceDir, stagingApp, { recursive: true, verbatimSymlinks: true })`.
- All URL conversions strictly use `fileURLToPath` and `pathToFileURL`, safely handling spaces, percent-encoding, and special characters.

### 2. Structured Deterministic Tree Digest
- Manifest `sha256` represents the SHA-256 hash of a deterministic JSON serialization of sorted structured entry tuples:
  - Regular files: `["file", relPath, stat.mode & 0o7777, bytes.length, fileSha256]` (captures exact octal permission mode bits and content hash).
  - Symlinks: `["symlink", relPath, linkTarget]` (captures relative symlink target string).
  - Directories: `["dir", relPath, stat.mode & 0o7777]` (captures directory hierarchy and permission bits).
- Sorted using binary codepoint comparison `(a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)`.
- Verified on `stagingApp` before any pointer switch.
- Regular file size check is unconditional (`tree.totalBytes !== manifest.sizeBytes`).

### 3. Preserved Authored Permissions (No Chmod Mutation)
- The staged binary `stagingApp/kilo2` is verified to be a regular file and executable (`(stat.mode & 0o111) !== 0`).
- If non-executable, `applyUpdate` refuses the payload (`Update payload launcher binary at app/kilo2 is not executable`) rather than mutating it with `chmod`. The authored artifact must arrive with valid permissions.

### 4. Early Manifest BuildId Validation
- `manifest.buildId` is validated up-front via `validateBuildDirName` before any staging path (`.staging-${manifest.buildId}-<uuid>`) or destination path is constructed, preventing path traversal before disk allocation.

### 5. Symlink Escape & Non-Regular File Scanning
- Mirrors `packages/kilo-cli/script/build-portable.ts` lines 430–452 (`scanLinks`):
  - Every symlink in the staged directory is dereferenced via `realpath(full)` and checked to confirm it resolves strictly within `stagingApp`. Escapes throw `Artifact contains symlink escapes outside the output dir`.
  - Non-regular special files (FIFOs, sockets, character/block devices) are detected and refused (`Artifact contains non-regular special files`).
  - Never recurses through symlinks.

### 6. Ownership & Permission Boundaries (Never Swallow Unsafe State)
- `verifyOwnershipAndMode` enforces:
  - Owner check: `stat.uid === process.getuid()` (on POSIX; prevents operating on files owned by another user).
  - Mode check: `(stat.mode & 0o022) === 0` (rejects group-writable or world-writable directories and files).
- Enforced on `installRoot`, `kilo2` launcher script, `kilo2.previous`, and `update-state.json`.
- `readUpdateState` explicitly distinguishes `ENOENT` (genuinely absent state, returning `undefined`) from unsafe permissions, invalid JSON, or tampered paths (which throw explicit refusal errors and are never swallowed).

### 7. Atomic Pointer Switch & Running Build Preservation
- Matching `packages/kilo-cli/script/build-tui.ts`:
  `exec "$here/build-<buildId>/app/kilo2" "$@"` (with ACP default `"$here/../acp"`).
- Target directory collision prevention: if `build-<newBuildId>` already exists on disk, `applyUpdate` refuses rather than deleting it (`Target build directory already exists; refusing to overwrite or delete it: build-<id>`), ensuring live sessions are preserved.
- The active running build directory is never unlinked or renamed.
- Atomic pointer switch via temporary launcher script `.kilo2-<uuid>.tmp` (mode `0o755`) and POSIX `rename(2)` over `kilo2`. Previous launcher backed up to `kilo2.previous`.

### 8. Rollback Mechanics
- Primary path: inspects `update-state.json`, reads restored `build.json` for accurate versioning, atomically swaps launcher via `createLauncherScript`, and rewrites state.
- Fallback path (`kilo2.previous` when state is missing): parses `detectedBuildDir`, validates build dir name (`isValidBuildDirName`), restores launcher, and rewrites `update-state.json` to prevent stale state.

---

## 3. Local Verification Results

Run with bundled Bun 1.4.0 (`packages/kilo-cli/dist/interactive/bun`):

```bash
env -C packages/kilo-cli ./dist/interactive/bun test test/updater.test.ts
bun test v1.4.0 (34cbb9a40)

 20 pass
 0 fail
 97 expect() calls
Ran 20 tests across 1 file. [681.00ms]
```

### Verified Test Cases (`test/updater.test.ts`)
1. `updater is inert by default without manifest URL or install root`
2. `updater refuses protected system and stable Kilo paths`
3. `verifyInstallRoot resolves parent symlinks via canonicalPath without touching live config`
4. `verifyOwnershipAndMode enforces current owner and rejects group/world-writable permissions`
5. `readUpdateState refuses unsafe permissions and malformed json while allowing absent state`
6. `build directory name validation rejects path traversal and invalid characters`
7. `digestDirectoryTree encodes structured tuples with exact permission modes and deterministic sort`
8. `scanDirectoryEntries detects symlink escapes outside the artifact root`
9. `manifest validation enforces channel, platform, and hash integrity`
10. `check identifies up-to-date vs update-available against local manifest`
11. `real local directory payload stages binaries, relative symlinks, and handles file URLs with spaces`
12. `refuses non-executable launcher in source payload without altering mode`
13. `manifest buildId is validated before creating any staging path`
14. `symlink escape inside directory payload is refused before promotion`
15. `applyUpdate refuses existing destination build directory without deleting anything`
16. `applyUpdate returns explicit unsupported diagnostic for archive extraction`
17. `tree digest integrity mismatch refuses update, cleans staging, and preserves launcher intact`
18. `rollback restores previous launcher pointer, records restored version, and keeps all build directories`
19. `rollback fallback path via kilo2.previous restores build and writes state when update-state.json is missing`
20. `rollback with no previous build available throws descriptive error`

### Typecheck
`bun run typecheck` (`tsgo --noEmit`) in `packages/kilo-cli`: **0 errors introduced in owned files**.

---

## 4. Remaining Shipping Gates (No Claim Row Closed)

**Completed CLI integration (2026-09-07):** `commands.ts` and `tui-preview.ts` expose check/apply/rollback before interactive store initialization. The 22 updater/command tests pass (118 assertions). Bundled-command acceptance staged the actual 718,102,380-byte portable tree (67,140 entries), launched the copied executable, detected the current version, and rolled back while retaining both builds. All writes used an isolated temporary installation, removed afterward. Evidence: parent thread storage `goal79-update-portable-bundled.log` and `goal79-integration-evidence.md`.

Remaining:
1. **Archive (.tar.gz) Unpacker Tooling**: Safe extraction of 800+ MB portable archives carrying relative symlinks remains gated pending trusted unpacker tooling; real directory staging satisfies local packaging.
2. **Distribution & Transport Security**: Production HTTPS endpoint with signing/notarization verification for remote manifest and payload distribution (skipped under local-only staging).
3. **Release Governance**: Formal decision on channel naming and manifest release publishing workflow.
