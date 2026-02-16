# PR #321 Review Log

**PR Title:** refactor(kilo-vscode) Massive changes, refactor everything  
**Author:** bernaferrari  
**Base:** dev ← **Head:** all-new  

## Review Plan

Files are grouped into 8 bundles for review:

1. **Core extension** — extension.ts, KiloProvider.ts, AgentManagerProvider.ts, package.json
2. **CLI backend services** — auth.ts, connection-service.ts, http-client.ts, index.ts, server-manager.ts, sse-client.ts, types.ts
3. **New services** — auto-purge, code-actions, contributions, marketplace, mdm, prompt-enhancement, search, settings/*
4. **Utils & types** — logger, open-external, path-security, telemetry, webview-csp, tar-fs.d.ts
5. **Autocomplete changes** — handleChatCompletionRequest, AutocompleteInlineCompletionProvider, continuedev, FileIgnoreController
6. **Docs, config, scripts, CI** — .vscode/*, scripts/*, AGENTS.md, docs/*, README, LICENSE, etc.
7. **Tests** — connection-service.integration.test.ts, contribution-tracker.test.ts
8. **Outside kilo-vscode** — gateway, kilo-ui, bun.lock

## Bundle Reviews

_(Reviews will be appended below as each bundle is completed)_

### Bundle 1: Core Extension Files

#### extension.ts
- Significant expansion of surface area: registers many new commands (URL ingestion, workspace search/indexing, GitHub integration, “scan workspace for secrets”, commit message generation, review changes, slash/workflow command helpers, etc.). This increases attack surface and makes audit burden higher.
- **Security / SSRF risk:** new URL ingestion uses `fetch()` on arbitrary user-provided `http(s)` URLs and reads the entire body with `response.text()` before clipping to `URL_INGESTION_MAX_CHARS`. There is no timeout/abort, no max-bytes streaming cap, and no blocklist for private IP ranges; a malicious/accidental URL can hit internal services or hang/consume memory.
- **Security / privacy:** commit message generation and “review changes” collect staged/working tree diffs and send content to the CLI backend. Default excludes only lockfiles; secrets (e.g. `.env`, key material) can be included. Recommend stronger defaults and/or a confirmation UI that previews/redacts content before sending.
- Adds `execFile("git", …)` helper; args are mostly constant, so command injection risk is low, but output buffering is capped (2MB) and may fail on large repos/diffs.
- Architectural: `KiloProvider` ctor signature changes (now receives full `ExtensionContext`) and `AgentManagerProvider` ctor signature changes (now depends on `KiloConnectionService` + callback), so this is a breaking internal refactor; ensure all instantiations match (sidebar + tabs).
- Style: frequent `try/catch` blocks; this conflicts with the “avoid try/catch” guidance in `AGENTS.md`, though much of this is I/O-driven and may be acceptable if consistent across the refactor.

#### KiloProvider.ts
- **Positive security change:** adds workspace-scoped path restrictions when opening/reading `file://` attachments and when opening local paths. Blocking file access outside workspace roots + temp attachments dir is a strong improvement.
- **Security concern:** attachment handling can download arbitrary `http(s)` URLs via `fetch()` (`readAttachmentBytes`) with no timeout and no size cap, and data-URL decoding can allocate unbounded memory. If the webview message channel can be triggered via an injection bug, this becomes a powerful primitive (SSRF + disk writes). Recommend: enforce `https` by default, add max download size (stream + cap), add AbortController timeout, and cap data-url payload size.
- CSP: webview CSP moves from an explicit string (including `connect-src` localhost wildcards) to `buildWebviewCsp()` and removes wildcard localhost network access. This is a net security win, but verify webview networking still works (the webview must not need direct `connect-src` to localhost; if it does, this will be a breaking change).
- Behavior change: `getWorkspaceDirectory()` now falls back to `os.homedir()` instead of `process.cwd()`. Safer than an arbitrary extension-host cwd, but it also means backend APIs may operate against the home directory when no workspace is open.

#### AgentManagerProvider.ts
- Major new feature set: parallel worktrees and multi-session orchestration (creates worktrees, opens in new window, creates “setup script”, manages metadata/state). This is high-risk code to merge without very careful path validation.
- **High severity:** `removeWorktree()` falls back to `fs.rm(worktreePath, { recursive: true, force: true })` if `git worktree remove` fails. If `worktreePath` is corrupted/manipulated (e.g. persisted state tampering), this can delete arbitrary directories. Mitigations recommended: hard-validate that `worktreePath` is inside `${workspaceDir}/.kilocode/worktrees/` and refuse otherwise; avoid `force`/`recursive` fallback (or require explicit user confirmation showing the resolved absolute path).
- `git worktree remove --force` is used. Even without fallback deletion, this is destructive; consider prompting/confirming and surfacing the path/branch being removed.
- Writes an executable `.kilocode/setup-script` and makes it `0o755` on non-Windows. If the backend automatically executes this script, it becomes an RCE vector (repo-local script execution). Ensure it is strictly opt-in, documented, and never auto-created/auto-executed without explicit user action.
- External dependency: share URLs default to `https://app.kilo.ai/share/<id>`. This is likely intended, but still worth calling out for privacy/compliance review (hardcoded external host).

#### package.json
- Packaging/identity changes: adds `publisher`, `license`, `repository`, `homepage`, `bugs`, icon, categories/keywords. Verify `publisher` matches the expected official Marketplace publisher; in an “untrusted author” PR this is a notable supply-chain concern.
- `engines.vscode` changes from `^1.109.0` to `^1.107.0`. This may widen compatibility but can also mask use of newer APIs that won’t exist in older VS Code.
- `activationEvents` is populated with many `onCommand:*` and `onView:*` entries. This is normal for performance (lazy activation), but increases the number of activation paths.
- View container/view IDs changed (`kilo-code-new-sidebar` etc.). This is potentially breaking for persisted view state, contributions, and any tooling/scripts referencing old IDs.

**Bundle 1 Summary:** Security posture improves in some areas (CSP tightening, local path restrictions), but several new capabilities are high-risk: arbitrary URL fetching, attachment downloading without limits, and especially destructive worktree removal with a recursive forced filesystem delete fallback. This bundle needs additional guardrails (size/time limits, allowlists, and strict path validation + confirmations) before it should be merged from an untrusted author.

### Bundle 2: CLI Backend Services

#### auth.ts (NEW)
- Introduces a helper for Basic Auth header generation and a hardcoded username (`"kilo"`). Given this is intended for loopback (`127.0.0.1`) auth to the bundled CLI, a fixed username is acceptable, but it should be treated as a protocol constant (not a user identity).
- **Style/lint risk:** file has no semicolons and uses mixed formatting compared to repo norms (ESLint likely enforces semicolons). This may fail `pnpm lint`/`pnpm compile` unless the lint rules are relaxed elsewhere.
- Security: helper only base64-encodes credentials (not encryption). That’s fine for HTTP Basic over loopback, but it becomes risky if `baseUrl` ever stops being strictly localhost.

#### connection-service.ts
- Adds dependency-injection seams (`createServerManager`, `createHttpClient`, `createSseClient`) which improves testability and reduces hidden coupling.
- Adds `"reconnecting"` as a first-class connection state.
- Behavior change: SSE errors only transition to `"error"` before initial connect completes; after connect, SSE reconnect/disconnect is handled inside `SSEClient`. This makes transient SSE drops less disruptive, but also means persistent SSE failure after initial connect may be less visible to callers unless they explicitly handle `"reconnecting"`/`"disconnected"`.
- Passes `username` through `ServerConfig` (new required field), so any other construction sites must be updated accordingly.

#### http-client.ts
- **Positive reliability/security:** adds `AbortController` timeouts for connect (10s) and request (60s). This is a meaningful improvement against hangs/DoS via stalled localhost calls.
- **Logging privacy concern:** on invalid JSON responses it logs `rawSnippet` (first 400 chars) and on non-OK responses it may log `errorMessage` derived from `rawText`. If the CLI backend ever includes user/session content in error bodies, this can leak sensitive data into the extension host logs.
- Adds multiple new endpoints (todos CRUD, session fork/revert/unrevert, children listing, `/command`, cloud settings + remote sessions). This expands the extension↔CLI API surface area; from an untrusted author, this warrants extra scrutiny of the CLI backend routes to ensure no unexpected outbound networking/data exfiltration is introduced there.
- **Policy enforcement risk:** `getExtensionSettings()` fails open (returns `{}`) when the cloud endpoint is unavailable. If org/user policy is security-critical (e.g. disabling providers), this should likely fail closed or at least surface a stronger user-facing warning.
- Style: introduces additional `try/catch` blocks (repo guidance says “avoid try/catch”), though fetch error handling may justify it.

#### index.ts
- Re-exports new types (`CommandDefinition`, `KiloExtensionSettings`, `RemoteSessionInfo`, `RemoteSessionMessage`). Mostly mechanical, but reinforces the expanded public API surface.

#### server-manager.ts
- Adds `KILO_SERVER_USERNAME` env var and returns `username` in the `ServerInstance`, aligning with the new Basic Auth helper.
- Uses cryptographically strong random password (`randomBytes(32)` → hex) and only logs password length (good).
- Still relies on parsing stdout for the bound port. If the bundled CLI binary is ever compromised, this parse is an easy place to spoof, but that risk exists regardless of the refactor.
- No obvious backdoor/exfil behavior in this diff (only spawns bundled `bin/kilo` with loopback server settings).

#### sse-client.ts
- **Positive reliability:** introduces exponential-backoff reconnect handling + max attempts for initial connect, and adds `"reconnecting"` state. Also adds test seams (`createEventSource`).
- Security: keeps auth in headers and logs only username/password length.
- Observability trade-off: after an initial successful connect, subsequent `EventSource` errors do not emit `notifyError()` (only state transitions + reconnect). That’s reasonable for auto-reconnect, but it may hide repeated error conditions from higher-level UI unless state is surfaced prominently.

#### types.ts
- Makes `ServerConfig.username` required (breaking for any direct callers). Connection service/server manager appear updated to supply it.
- Adds new message/session metadata (`providerID`, `modelID`, `revert`, `summary`) and supports richer `MessagePart` shape including `file` attachments.
- Broadens config typing for custom providers and adds keybinds; uses `Record<string, unknown>` (acceptable; avoids `any`).
- `McpStatus` now carries optional `authUrl` in all variants, which is a good UX improvement but should be validated before opening externally.

**Bundle 2 Summary:** No overtly suspicious network/exfiltration patterns were found in the diffs themselves; most changes are auth plumbing (Basic auth username), timeouts, reconnect logic, and API surface expansion. Primary concerns are (1) potentially sensitive raw response snippets being logged on parse errors, and (2) policy/settings endpoints failing open. This bundle is plausibly legitimate refactor work, but given the author is untrusted, it should be paired with a review of the corresponding CLI backend routes and a tightening of logging to avoid leaking user/session content.

### Bundle 3: New Services

#### auto-purge-service.ts (NEW)
- Clean `Disposable` implementation that periodically purges stale temp attachment files and old global state entries.
- **Security: filesystem traversal** — [`purgeDirectory()`](src/services/auto-purge/auto-purge-service.ts:74) recurses into subdirectories under `tempAttachmentsDir`. The default dir (`os.tmpdir()/kilo-code-vscode-attachments`) is reasonable, but the `tempAttachmentsDir` option is caller-controlled. If ever set to a broader directory (e.g. the workspace root), this could delete non-Kilo files. No path-boundary validation is performed. Recommend: validate that `tempAttachmentsDir` is inside `os.tmpdir()` or the extension's storage path.
- Uses `fs.rm(entryPath, { force: true })` for individual files, which is acceptable (not recursive). Uses `fs.rmdir()` for empty directories only — correct behavior.
- **Style:** uses `try/catch` in [`isStale()`](src/services/auto-purge/auto-purge-service.ts:106) and [`purgeDirectory()`](src/services/auto-purge/auto-purge-service.ts:74) — acceptable for filesystem I/O, though the codebase guidance says "avoid try/catch".
- `shouldPurgeSessionCache` and `shouldPurgeAgentManagerState` use defensive `as` casts like `(entry as { updatedAt?: unknown }).updatedAt`. These are safe runtime checks, not bypasses.
- Agent manager state uses `retentionMs * 4` (28 days default). This magic multiplier should be a named constant or documented parameter.

#### auto-purge/index.ts (NEW)
- Barrel re-export. No issues.

#### KiloCodeActionProvider.ts (NEW)
- Registers code actions for "Explain Selection", "Fix Selection", and "Improve Selection", plus a "Fix This Diagnostic" quick-fix when a diagnostic is present.
- Commands use the `kilo-code.new.` prefix as required by AGENTS.md naming convention.
- [`provideCodeActions()`](src/services/code-actions/KiloCodeActionProvider.ts:16) only takes the first diagnostic (`context.diagnostics[0]`). If multiple diagnostics overlap a range, only the first is surfaced as a quick-fix. This is a UX limitation, not a security issue.
- **Style nit:** `providedCodeActionKinds` is declared as a plain object on the instance but should likely be a `static` readonly mapping or class-level constant, since it's the same for all instances.
- No security concerns — only creates VS Code `CodeAction` objects with command references.

#### contribution-tracker.ts (NEW)
- Tracks file-level additions/deletions from tool calls (`edit`, `write`, `apply_patch`, `fast_edit_file`) by diffing before/after content. Stores records in `workspaceState`.
- **Code quality:** [`recordFromPart()`](src/services/contributions/contribution-tracker.ts:145) casts `part` to `ToolPartPayload` without validation. The defensive checks (`payload?.type !== "tool"`, etc.) prevent misuse, but the initial cast is `as`-heavy. The surrounding code mitigates the risk by checking every field.
- Uses `diffLines` from the `diff` package directly on potentially large file contents. No size guard — a very large before/after pair could cause high CPU/memory use during diff computation. Consider a size cap.
- Deduplication uses a concatenated string key (`sessionID:messageID:partID:tool:filePath`). If any field contains `:`, keys can collide. In practice this is unlikely for session/message IDs but theoretically possible for file paths.
- `MAX_RECORDS = 2000` with `.slice(-MAX_RECORDS)` trim — good bounded storage.
- **Style:** uses `void ... .then(undefined, ...)` fire-and-forget pattern for state persistence — reasonable for non-critical data.

#### marketplace/index.ts (NEW)
- Barrel re-export. No issues.

#### marketplace/marketplace-service.ts (NEW)
- **This is the highest-risk file in Bundle 3**. It performs network requests, downloads tarballs, and writes to the filesystem.
- **Security: tarball extraction** — [`installSkill()`](src/services/marketplace/marketplace-service.ts:700) downloads a tarball from `item.content` (a URL from the catalog API), writes it to a temp file, then extracts with `tar-fs` using `strip: 1`. **There is no URL validation** — the tarball URL comes from the marketplace API response, which is fetched from `https://api.kilo.ai` or environment-overridden URLs. If the API is compromised or if `KILO_API_URL`/`KILOCODE_BACKEND_BASE_URL` env vars are tampered, arbitrary tarballs could be extracted. The extraction destination is inside `.kilocode/skills/<id>` which is scoped, but tar-fs `strip: 1` does not guard against symlink-based path traversal within the tarball. Recommend: use a tar extraction library with explicit path-traversal protection (e.g. reject entries with `..` segments or absolute paths).
- **Security: MCP server install** — [`installMcp()`](src/services/marketplace/marketplace-service.ts:650) writes server configuration to `mcp.json`. The `item.id` is used as the key — if `item.id` contains characters like `.` or `/`, it could create unexpected JSON structure. The `content` is parsed as JSON/YAML and written directly. Since MCP server config can include `command` fields that get executed, a compromised catalog could inject arbitrary command execution. The mitigation is that the catalog source is trusted (kilo.ai API), but env-var overrides for the base URL weaken that guarantee.
- **Security: parameter template injection** — [`installMcp()`](src/services/marketplace/marketplace-service.ts:660) replaces `{{param.key}}` in content strings using `new RegExp(...)`. The `param.key` value comes from the catalog and is **not regex-escaped**, so a specially crafted `key` could cause ReDoS or unexpected replacements. Recommend: escape `param.key` before using in `RegExp` constructor, or use `String.prototype.replaceAll()`.
- **Network:** [`fetchCatalogText()`](src/services/marketplace/marketplace-service.ts:480) tries multiple base URLs with retries. The `User-Agent` header is `kilo-code-vscode-marketplace` — fine, but note this reveals extension identity to remote servers.
- `resolveMarketplaceBaseUrls()` reads `process.env.KILO_API_URL` and `KILOCODE_BACKEND_BASE_URL`. These are standard configuration patterns, not exfiltration vectors.
- **Code quality:** the `parseStructured()` method handles double-encoded JSON (JSON string containing JSON/YAML) which is fragile. Multiple fallback attempts (JSON → YAML → double-decode) increase the chance of misinterpretation.
- `getLegacyGlobalStoragePath()` hardcodes `kilocode.kilo-code` publisher ID for cross-platform storage paths. This is for migration and appears legitimate.

#### marketplace/schema.ts (NEW)
- Zod schemas for marketplace catalog validation. Well-structured discriminated unions.
- No security issues — purely declarative validation schemas.

#### marketplace/types.ts (NEW)
- TypeScript interfaces for marketplace data. No logic, no issues.

#### mdm/mdm-policy.ts (NEW)
- Reads machine-level MDM policy from well-known system paths (`/Library/Application Support/KiloCode/mdm.json` on macOS, `C:\ProgramData\KiloCode\mdm.json` on Windows, `/etc/kilo-code/mdm.json` on Linux).
- **Security: path safety** — file paths are constructed from constants, not user input. The only dynamic part is `isDevelopment` selecting between `mdm.json` and `mdm.dev.json`. No traversal risk.
- **Security: fallback to RooCode paths** — also checks `RooCode` directories. This is a legacy migration concern; if an attacker can write to `/Library/Application Support/RooCode/mdm.json` they could influence policy, but that requires system-level write access which implies game-over anyway.
- `evaluateMdmCompliance()` is a pure function with clear logic. No issues.
- Uses `.strict()` on the zod schema, which rejects unexpected fields — good defensive practice.
- Style: clean, follows early-return pattern.

#### prompt-enhancement/handleEnhancePromptRequest.ts (NEW)
- Uses the FIM completion endpoint to rewrite user prompts. The prompt is sandwiched between a system prefix/suffix.
- **Security: prompt injection** — the user's prompt text is injected directly into the FIM prefix without escaping. In this context that's by design (the user controls their own prompt), but if this endpoint were ever exposed to untrusted input, the system prompt could be overridden. Current usage appears safe.
- [`cleanEnhancedPrompt()`](src/services/prompt-enhancement/handleEnhancePromptRequest.ts:50) strips code fences and wrapping quotes — defensive post-processing.
- Sends empty response on failure (swallows errors) — acceptable UX choice for a non-critical enhancement feature.
- No outbound network calls beyond the existing CLI backend FIM endpoint.

#### search/workspace-search.ts (NEW)
- **Security: command execution** — [`runRipgrep()`](src/services/search/workspace-search.ts:36) uses `execFile("rg", args, { cwd })` which is safe against shell injection (no shell interpolation with `execFile`). Arguments are constructed from constants and the user's query string. The query is passed as a positional arg to ripgrep, not through a shell. `maxBuffer: 8MB` caps output.
- **Potential issue:** `--hidden` flag includes dotfiles in search results. Combined with `!.git` exclusion, this should be fine, but `.env` files and other sensitive hidden files will appear in search results. Consider honoring `.gitignore` (ripgrep does this by default unless `--no-ignore` is used, so this should be OK).
- [`SimpleCodeIndexService.rebuild()`](src/services/search/workspace-search.ts:235) lists up to 50,000 files. This is a reasonable cap. Uses `rg --files` which respects `.gitignore` by default.
- **Style:** scoring uses `score += N` compound assignments — readable but could use named constants for magic numbers (12, 10, 5, 3, 14, etc.).
- The `semanticSearch` method spawns up to 6 ripgrep processes (1 seed + up to 5 term searches) sequentially. This could be slow for large workspaces but is bounded.

#### settings-sync/index.ts (NEW)
- Manages VS Code `globalState.setKeysForSync()` registration for Settings Sync.
- Legacy key migration in [`migrateLegacySyncKeys()`](src/services/settings-sync/index.ts:73) — reads old keys and writes to new keys. Safe one-way migration.
- `sessionHistoryCacheKey()` uses `Buffer.from(workspaceDir).toString("base64url")` — deterministic and collision-free key derivation.
- `readSettingsActiveTab()` validates against an allowlist (`ALLOWED_SETTINGS_TABS`) — good defensive coding. Falls back to `"providers"` for unrecognized values.
- **Style:** `writeSettingsActiveTab` and `writeLastProviderAuth` correctly validate input types before persisting.
- No security concerns.

#### settings/provider-config-normalization.ts (NEW)
- Normalizes legacy webview field names (`api_key` → `options.apiKey`, `base_url` → `options.baseURL`) into the backend-native shape.
- Pure data transformation — no I/O, no network calls, no security concerns.
- **Style:** uses `delete` on the normalized object to remove legacy keys. Mutating the spread copy is fine since it's a fresh object.
- `normalizeProviderConfigMap()` filters empty provider IDs — defensive.

#### settings/rules-workflows.ts (NEW)
- Manages creation, deletion, toggling, and listing of rule/workflow `.md`/`.txt` files in `~/.kilocode/rules/` (global) and `.kilocode/rules/` (local).
- **Security: path traversal protection** — [`ensurePathInsideScope()`](src/services/settings/rules-workflows.ts:192) uses `isPathInsideAnyRoot()` utility to validate the resolved path stays inside the expected directory. This is the correct approach.
- **Security: filename sanitization** — [`normalizeFilename()`](src/services/settings/rules-workflows.ts:170) strips non-alphanumeric chars except `._-`, takes `path.basename()`, and enforces `.md`/`.txt` extension whitelist. Good defense against traversal via filenames like `../../etc/passwd`.
- [`deleteFile()`](src/services/settings/rules-workflows.ts:99) uses `fs.unlink()` (single file, not recursive) — safe.
- Toggle state stored in `globalState`/`workspaceState` with string keys — clean approach.
- **Style:** clean class structure with early returns.

#### settings/validation.ts (NEW)
- Comprehensive Zod validation for the full `Config` patch schema, individual setting updates, and autocomplete settings.
- Uses `.strict()` on config schemas where expected shapes are known — rejects unexpected fields.
- Uses `.passthrough()` on provider model/options schemas — allows forward-compatibility with new backend fields. This is a reasonable trade-off; strict schemas would be safer but would break on backend updates.
- [`validateConfigPatch()`](src/services/settings/validation.ts:260) invokes `normalizeProviderConfigPatch()` after validation — correct ordering (validate raw input, then normalize).
- `stripUndefinedDeep()` recursively cleans the output — defensive.
- `experimentalConfigSchema` caps `mcp_timeout` at 600,000 (10 min) — reasonable upper bound.
- No security concerns — purely declarative validation.

**Bundle 3 Summary:** The most significant security concern in this bundle is the **marketplace service's tarball download and extraction** ([`installSkill()`](src/services/marketplace/marketplace-service.ts:700)), which lacks path-traversal protection during tar extraction and trusts URLs from an API response that can be redirected via environment variables. The **regex injection in MCP parameter templates** is a secondary concern. The `rules-workflows` and `workspace-search` services have proper path validation and safe process execution patterns respectively. The `auto-purge`, `contribution-tracker`, `settings-sync`, `validation`, and `provider-config-normalization` services are well-structured with no suspicious patterns. No backdoors or data exfiltration were detected. Key recommendations: (1) add tar extraction path-traversal guards, (2) regex-escape template parameter keys in marketplace MCP install, (3) validate `tempAttachmentsDir` stays within expected boundaries, (4) consider size guards for contribution tracker diffs.

### Bundle 4: Utils & Types

#### logger.ts (NEW)
- Clean logging utility: [`initializeLogger()`](src/utils/logger.ts:9) stores a VS Code `OutputChannel`, then [`write()`](src/utils/logger.ts:35) formats timestamped messages to both the output channel and console.
- [`formatArg()`](src/utils/logger.ts:17) uses `node:util.inspect()` with `depth: 6` — reasonable depth, no security concern.
- Debug messages are gated by [`debugEnabled`](src/utils/logger.ts:7) flag — good for performance.
- **Style note:** Missing `[Kilo New]` prefix in log output (AGENTS.md says "All debug output must be prepended with `[Kilo New]`"). The format is `[timestamp] [LEVEL] message` without the prefix. Consumers would need to add it themselves.
- **Style:** Uses `let` for [`outputChannel`](src/utils/logger.ts:6) and [`debugEnabled`](src/utils/logger.ts:7) — necessary for mutable module state, acceptable.
- No security concerns, no hardcoded URLs, no data exfiltration.

#### open-external.ts (NEW)
- **Security: well-designed URL allowlist.** [`parseAllowedOpenExternalUrl()`](src/utils/open-external.ts:5) validates input with Zod string parsing, then constructs a `URL` object, then checks protocol against [`ALLOWED_OPEN_EXTERNAL_SCHEMES`](src/utils/open-external.ts:3) (`https:` and `vscode:` only).
- Returns `null` on any validation failure — safe fail-closed pattern.
- `try`/`catch` around `new URL()` — necessary here since URL constructor throws on invalid input. One of the few legitimate uses of try/catch per style guide spirit.
- Blocks `file:`, `javascript:`, `data:`, `http:` schemes — correct security posture.
- Returns `parsedUrl.toString()` which normalizes the URL — prevents ambiguous URL tricks.
- **No concerns.** This is a textbook URL validation utility.

#### path-security.ts (NEW)
- **Security: core path-traversal defense.** [`isPathInsideAnyRoot()`](src/utils/path-security.ts:17) resolves symlinks via [`realpathOrResolved()`](src/utils/path-security.ts:4), normalizes for case on Windows, then checks if the candidate path starts with `root + path.sep` (or equals root exactly).
- **Symlink handling is correct:** `fs.realpath()` resolves symlinks, falling back to `path.resolve()` if the path doesn't exist yet. This prevents symlink-based escapes.
- **The `path.sep` suffix check is critical and correctly implemented** — `candidateCanonical.startsWith(`${rootCanonical}${path.sep}`)` prevents `/root-evil` from matching `/root`. This is a common mistake in path security code and they got it right.
- **Windows normalization:** [`normalizePathForCompare()`](src/utils/path-security.ts:12) lowercases on win32 — correct for case-insensitive filesystem comparison.
- `try`/`catch` in `realpathOrResolved()` — necessary since `fs.realpath` throws for non-existent paths.
- **Potential concern:** The `for` loop in `isPathInsideAnyRoot()` calls `realpathOrResolved()` for each root on every invocation. If called in a hot path with many roots, this could be a performance issue. Not a security concern though.
- **No backdoors, no suspicious patterns.** This is solid security infrastructure.

#### telemetry.ts (NEW)
- [`telemetryEventNameSchema`](src/utils/telemetry.ts:5) uses `z.enum()` to whitelist telemetry event names — good, prevents arbitrary event injection.
- [`captureTelemetryEvent()`](src/utils/telemetry.ts:26) checks `vscode.env.isTelemetryEnabled` and respects user opt-out — correct.
- **Currently a no-op beyond logging:** The function only calls `logger.debug()`, it doesn't actually send telemetry anywhere. This is either a stub for future implementation or the telemetry was intentionally removed. Either way, **no data exfiltration risk** at present.
- [`parseTelemetryProperties()`](src/utils/telemetry.ts:20) uses `z.record(z.unknown())` — permissive but only used for logging, not sent anywhere.
- **No hardcoded URLs, no external requests, no tracking endpoints.** Clean.

#### webview-csp.ts (NEW)
- [`buildWebviewCsp()`](src/utils/webview-csp.ts:7) constructs a Content Security Policy string from a `cspSource` and `nonce`.
- **CSP comparison with existing [`KiloProvider.ts`](src/KiloProvider.ts:1280):**
  | Directive | Existing KiloProvider | New webview-csp.ts |
  | --- | --- | --- |
  | default-src | `'none'` | `'none'` ✓ |
  | style-src | `'unsafe-inline' ${cspSource}` | `'unsafe-inline' ${cspSource}` ✓ |
  | script-src | `'nonce-...' 'wasm-unsafe-eval'` | `'nonce-...' 'wasm-unsafe-eval'` ✓ |
  | font-src | `${cspSource}` | `${cspSource}` ✓ |
  | connect-src | `http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*` | `${cspSource}` ⚠️ **Different** |
  | img-src | `${cspSource} data: https:` | `${cspSource} data: blob:` ⚠️ **Different** |
- **`connect-src` difference is significant:** The existing CSP restricts connections to `localhost`/`127.0.0.1` (for the CLI backend). The new utility uses `${cspSource}` which is VS Code's webview resource origin — this would **break SSE/HTTP connections to the CLI backend** unless the CSP is further customized at call sites. Need to verify how this utility is actually used.
- **`img-src` difference:** Existing allows `https:` (any HTTPS image), new allows `blob:` instead. The `blob:` addition is needed for inline-generated images; dropping `https:` is more restrictive (good for security, but may break remote image loading in markdown previews).
- **No `'unsafe-eval'` anywhere** — correct, only `'wasm-unsafe-eval'` which is needed for WASM.
- **No hardcoded external domains** — clean.
- **Minor:** The `input.cspSource` and `input.nonce` are not sanitized/escaped. If a caller passes a nonce containing `'`, it could break out of the CSP. In practice, nonces are generated internally so this is low risk, but a paranoid implementation would validate the nonce format.

#### tar-fs.d.ts (NEW)
- Minimal type declaration for the `tar-fs` package — declares `extract(cwd, options?)` returning a `Writable` stream with optional `strip` level.
- **Notably missing:** No `map` option in `ExtractOptions`. The `tar-fs` library supports a `map` callback that can rewrite entry paths during extraction — this is exactly the mechanism needed to implement path-traversal protection during tar extraction (as noted in Bundle 3's marketplace review). The type declaration omitting `map` makes it harder for developers to discover and use this security feature.
- **Recommendation:** Add `map?: (header: { name: string }) => { name: string }` to `ExtractOptions` to surface the path-rewriting capability that should be used for safe extraction.
- No security concerns in the type declaration itself.

**Bundle 4 Summary:** These utilities are well-written and demonstrate good security practices. The [`open-external.ts`](src/utils/open-external.ts:1) URL allowlist and [`path-security.ts`](src/utils/path-security.ts:1) path-traversal defense are both correctly implemented with no bypasses found. The [`telemetry.ts`](src/utils/telemetry.ts:1) is currently a no-op (logs only, sends nothing) — no exfiltration risk. The [`webview-csp.ts`](src/utils/webview-csp.ts:1) CSP is slightly different from the existing KiloProvider CSP in `connect-src` and `img-src` directives — the `connect-src` change needs verification to ensure it doesn't break CLI backend connectivity when used. The [`tar-fs.d.ts`](src/types/tar-fs.d.ts:1) type declaration should be extended with the `map` option to enable path-traversal-safe extraction. No backdoors, data exfiltration, or suspicious patterns were found in any file. **No blocking security issues.**

### Bundle 5: Autocomplete Changes

#### handleChatCompletionRequest.ts
- Single-line change: passes `workspacePath` to [`new FileIgnoreController(workspacePath)`](src/services/autocomplete/chat-autocomplete/handleChatCompletionRequest.ts:30) instead of no-arg constructor.
- This aligns with the `FileIgnoreController` constructor change (see below). Clean, no concerns.

#### AutocompleteInlineCompletionProvider.ts
- Same pattern: passes `workspacePath` to [`new FileIgnoreController(workspacePath)`](src/services/autocomplete/classic-auto-complete/AutocompleteInlineCompletionProvider.ts:285).
- Clean, no concerns.

#### GeneratorReuseManager.test.ts
- Removes one `// eslint-disable-next-line require-yield` comment from the test's mock error-throwing generator.
- Presumably the ESLint config was updated to not flag this pattern, or the rule was removed. Trivial cleanup, no concerns.

#### continuedev/core/llm/index.ts
- Removes two `// eslint-disable-next-line require-yield` comments from [`_streamFim()`](src/services/autocomplete/continuedev/core/llm/index.ts:235) and [`_streamComplete()`](src/services/autocomplete/continuedev/core/llm/index.ts:631) method stubs.
- Same eslint cleanup pattern as the test file. No functional change, no concerns.

#### llamaTokenizer.js
- **671KB vendored file**, but only 3 small changes:
  1. `==` → `===` strict equality in [`isEmpty()`](src/services/autocomplete/continuedev/core/llm/llamaTokenizer.js:38) — good, aligns with AGENTS.md strict equality rule.
  2. Two bare `throw "string"` converted to `throw new Error("string")` in test helpers — proper Error objects enable stack traces. Good improvement.
- No security concerns. No new code, no network calls, no dynamic execution.

#### FileIgnoreController.ts — **Most significant change in this bundle**
- **Replaces the dummy stub** with a real implementation that reads `.kilocodeignore` and `.gitignore` files and uses the [`ignore`](https://www.npmjs.com/package/ignore) library (already in `dependencies`) to filter paths.
- **Security review (positive):**
  - Uses `path.resolve()` and `path.relative()` to ensure files are within the workspace before checking ignore rules.
  - Files outside the workspace (relative path starts with `..`) return `null` from [`toRelativePath()`](src/services/autocomplete/shims/FileIgnoreController.ts:50) and are **allowed by default** (`validateAccess` returns `true`) — this is a permissive fallback, not a restrictive one.
  - Sensitive file check (`isSensitiveFile`) is preserved and checked first in [`validateAccess()`](src/services/autocomplete/shims/FileIgnoreController.ts:63).
  - No network calls, no `eval()`, no dynamic code execution.
  - The `ignore` package is a well-known, widely-used library for `.gitignore`-style pattern matching.
- **Security review (concerns):**
  - **Symlink following via `realpathSync`**: The [`toRelativePath()`](src/services/autocomplete/shims/FileIgnoreController.ts:46) method calls `fsSync.realpathSync(absoluteInput)` which resolves symlinks. A symlink inside the workspace pointing outside could resolve to a path that then fails the `relative.startsWith("..")` check and returns `null`, causing `validateAccess` to return `true` (allow). This is actually fine since the intent is to be permissive for unresolved paths — but it means symlinks to sensitive files outside the workspace will bypass ignore rules (though the `isSensitiveFile` check still applies).
  - **`file://` URI stripping** is basic — just strips `file://` prefix. Does not handle `file:///` (three slashes for absolute paths on Unix) or URL-encoded characters. This could cause `path.isAbsolute()` to fail on Unix where `file:///home/user/...` would become `/home/user/...` only if three slashes are used. The current `file://` strip would leave `/home/user/...` starting with `/` so `isAbsolute` would still work. Fine in practice.
- **Code quality:**
  - The `getInstructions()` output format is a bit odd — it appends the filename again at the end of each section (`${content.trimEnd()}\n\n${file}`). This looks like it might be intended as a footer/separator but reads strangely. Minor.
  - Good use of `async/await` for file reading with proper `try/catch` fallthrough on missing files.
  - The `dispose()` method properly resets state.

**Bundle 5 Summary:** This bundle is predominantly mechanical cleanup (passing `workspacePath` to constructors, removing stale eslint-disable comments, enforcing strict equality). The only substantive change is the [`FileIgnoreController.ts`](src/services/autocomplete/shims/FileIgnoreController.ts:1) rewrite from a dummy stub to a real `.gitignore`/`.kilocodeignore`-based file filter. The implementation is sound — it uses the well-established `ignore` npm package, properly constrains path resolution to the workspace, and preserves the existing sensitive-file checks. No backdoors, no network calls, no dynamic execution, no data exfiltration. **No blocking security issues.** The only minor note is the permissive default for files outside the workspace boundary and the slightly odd `getInstructions()` output format.

### Bundle 6: Docs, Config, Scripts, CI

#### .vscode/* config files

**[`launch.json`](.vscode/launch.json)**
- Removes `"preLaunchTask": "${defaultBuildTask}"` from both launch configurations ("Run Extension" and "Run Extension (Local Backend)"). This means the extension no longer auto-builds before debugging — the developer must ensure the build is running (via the watch task). Harmless DX change, likely intended to pair with the auto-start watch task below.
- No security concerns.

**[`settings.json`](.vscode/settings.json)**
- Adds `"task.allowAutomaticTasks": "on"` — enables VS Code to auto-run tasks marked with `runOn: "folderOpen"` without prompting. This is a workspace setting so it only affects this project. Combined with the `tasks.json` change below, it means the watch task starts automatically when the folder opens. Standard DX pattern.
- No security concerns — this is a development-time convenience setting.

**[`tasks.json`](.vscode/tasks.json)**
- ⚠️ **Switches from `npm` task type to `shell` with `bun run`**. The `watch:esbuild` and `watch:tsc` tasks now use `"type": "shell"` with `"command": "bun run watch:esbuild"` / `"bun run watch:tsc"` instead of `"type": "npm"` with `"script": "watch:esbuild"`. This is a problem: **AGENTS.md explicitly states this package uses pnpm, not Bun**. While the monorepo root uses Bun, the kilo-vscode package should use pnpm commands. This could break for contributors who don't have `bun` on PATH.
- Adds `"runOptions": { "runOn": "folderOpen" }` to the parent `watch` task — triggers auto-watch on folder open (paired with the settings.json change). Standard pattern.
- Adds an explicit `problemMatcher` for esbuild (replacing the built-in `$esbuild-watch` matcher) with background patterns for `[watch] build started` / `[watch] build finished`. The regex pattern `"regexp": "^$"` means it won't match any problem lines — this effectively makes esbuild errors invisible in the VS Code Problems panel. This looks intentional (esbuild outputs are handled differently) but is worth noting.
- No security concerns in the task definitions themselves.

**[`.vscodeignore`](.vscodeignore)**
- Adds `docs/**`, `tests/**`, `scripts/**`, `AGENTS.md`, `pnpm-lock.yaml`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs` to the ignore list. These are all development-only files that shouldn't be in the published VSIX. Good hygiene change.
- Moves `pnpm-lock.yaml` up in the file (was at the bottom, now grouped with other config files). No semantic change.
- No security concerns.

#### Scripts (bundle-size-audit.mjs, verify-migration-plan-complete.mjs)

**[`bundle-size-audit.mjs`](scripts/bundle-size-audit.mjs) (NEW)**
- Pure local filesystem script: reads `dist/webview.js`, `dist/webview.css`, and any `.vsix` file in the package root, reports sizes, and fails if thresholds are exceeded (25 MB for webview.js, 50 MB for VSIX).
- **Security review:** No network calls, no `eval()`, no dynamic code execution, no credential access. Only uses `node:fs/promises` and `node:path`. Reads files only within `process.cwd()`. Clean and straightforward.
- The 25 MB webview.js threshold is extremely generous (most webview bundles should be well under 5 MB). The 50 MB VSIX threshold is also very generous. These appear to be guardrails against catastrophic bundle bloat rather than tight size budgets.

**[`verify-migration-plan-complete.mjs`](scripts/verify-migration-plan-complete.mjs) (NEW)**
- Reads `docs/opencode-migration-plan.md` and checks for incomplete markers (`- [ ]`, `🔨 Partial`, `❌ Not started`). Fails if any are found.
- **Security review:** No network calls, no `eval()`, no dynamic code execution. Only reads a single markdown file from the workspace. Completely safe.
- Good CI gate to ensure the migration plan is fully completed before shipping.

#### CI workflow (vscode-extension-smoke.yml)

**[`vscode-extension-smoke.yml`](.github/workflows/vscode-extension-smoke.yml) (NEW)**
- Triggers on push to `dev` branch and on PRs affecting `packages/kilo-vscode/**` paths. Also supports `workflow_dispatch`.
- Runs on 3 OS matrix: ubuntu-latest, macos-latest, windows-latest.
- **Security review:**
  - Uses only well-known first-party actions: `actions/checkout@v4`, `oven-sh/setup-bun@v2`, `actions/upload-artifact@v4`. All pinned to major version tags (v4/v2). ⚠️ **Minor concern:** pinning to `@v4` instead of full SHA means a compromised tag could inject malicious code. For a public repo with CI this is standard practice, but for high-security contexts, SHA pinning is preferred.
  - **No secrets are used** — no `${{ secrets.* }}` references at all. The workflow only does: install deps, typecheck, lint, test, build, package, and upload artifact. No publishing, no deployment.
  - No `permissions` block is specified, so it gets default token permissions (`contents: read` for PRs from forks, broader for push). This is fine because the workflow doesn't use the token explicitly.
  - VSIX artifact is only uploaded on ubuntu-latest (avoids duplicates across OS matrix). Good.
  - ⚠️ **Uses `bun run` throughout** instead of `pnpm`. Same concern as tasks.json — AGENTS.md says this package uses pnpm. However, since the CI installs bun and the monorepo root uses bun, this may be intentional for CI consistency. Worth clarifying.
  - Steps include `test:unit`, `test:integration`, `test:themes`, `audit:migration-plan`, `audit:bundle` — comprehensive smoke test pipeline.
- **No data exfiltration, no secret exposure, no permission escalation.** Clean CI workflow.

#### AGENTS.md, README.md, LICENSE

**[`AGENTS.md`](AGENTS.md)**
- Single-line change under "Naming Conventions": updates the view ID convention from `kilo-code.new.` prefix (with dots) to alphanumeric-with-hyphens-only format (e.g., `kilo-code-new-sidebarView-main`). This aligns with VS Code's view ID constraints (some contexts don't handle dots well). Informational change, no security concern.

**[`LICENSE`](LICENSE) (NEW)**
- Standard MIT License with dual copyright: "Copyright (c) 2025 Kilo Code" and "Copyright (c) 2025 opencode". Standard boilerplate MIT text.
- The dual copyright attribution is reasonable for a project that builds on opencode.
- No concerns.

**[`README.md`](README.md)**
- Complete rewrite from VS Code extension template boilerplate to actual project documentation. Describes features, requirements (VS Code ^1.109.0), extension settings (lists `kilo-code.new.*` settings), and development commands.
- Good improvement — the old README was the default `yo code` generated template with placeholder text.
- No concerns.

#### Docs changes

45 documentation files modified, all within `docs/`. No new doc files created; all are updates to existing files.

- **Primary pattern:** The [`opencode-migration-plan.md`](docs/opencode-migration-plan.md) table updates nearly every feature from `❌ Not started` or `🔨 Partial` to `✅ Done`, with updated detail descriptions explaining what was implemented.
- **Individual feature docs** (chat-ui-features/*, non-agent-features/*, infrastructure/*, unknowns/*) are updated with implementation details, component references, and behavior descriptions matching the claimed "Done" status.
- **No executable content, no scripts, no links to external resources that could be malicious.** These are purely descriptive markdown files.
- ⚠️ **Accuracy concern:** The migration plan claims nearly everything is "✅ Done" — this is a massive claim for a single PR. The accuracy of these status claims depends on the actual code changes in the other bundles. The docs themselves are internally consistent but should be validated against the actual implementation.
- The `verify-migration-plan-complete.mjs` script (reviewed above) gates CI on all items being complete, which means merging this PR locks in the "everything is done" claim as a CI invariant.

**Bundle 6 Summary:** This bundle contains no security concerns. All scripts are pure local filesystem operations with no network calls, no `eval()`, no credential access, and no dynamic code execution. The CI workflow uses only trusted first-party GitHub Actions, exposes no secrets, and performs no publishing or deployment. Config changes are standard DX improvements (auto-watch on folder open, better .vscodeignore). Two notable issues: (1) **tasks.json and CI workflow use `bun run` instead of `pnpm`**, contradicting AGENTS.md's stated package manager — this should be clarified/resolved; (2) **the migration plan claims nearly all features are "✅ Done"** which is a very ambitious claim for a single PR and should be validated against actual implementation. **No blocking security issues.**

### Bundle 7+8: Tests + Outside kilo-vscode

#### Tests

##### [`connection-service.integration.test.ts`](tests/integration/connection-service.integration.test.ts) (NEW — 188 lines)

- Uses `bun:test` runner with fake/stub classes (`FakeServerManager`, `FakeSSEClient`) — good isolation, no real network or server processes.
- **Test 1 — lifecycle & deduplication:** Verifies that concurrent [`connect()`](src/services/cli-backend/connection-service.ts) calls are deduplicated (only one `getServer()` call), state transitions propagate correctly, [`getHttpClient()`](src/services/cli-backend/connection-service.ts) returns the injected fake, and [`dispose()`](src/services/cli-backend/connection-service.ts) cleans up both server manager and SSE client.
- **Test 2 — SSE event routing & session resolution:** Tests [`resolveEventSessionId()`](src/services/cli-backend/connection-service.ts) for `session.created`, `message.updated`, `message.part.updated`, `permission.asked`, `permission.replied`, and `question.asked` event types. Verifies that messageID→sessionID mapping is built from `message.updated` events and reused for `message.part.updated`.
- ⚠️ **Coverage gap:** No test for error states — `FakeSSEClient.emitError()` is defined but never called. Reconnection flow (`"reconnecting"` state) is also untested.
- ⚠️ **Coverage gap:** No test for [`disconnect()`](src/services/cli-backend/connection-service.ts) behavior or what happens when `connect()` is called after `dispose()`.
- ⚠️ **Uses `setTimeout` for sequencing** (`await new Promise(resolve => setTimeout(resolve, 0))`) — AGENTS.md explicitly discourages this pattern ("Avoid `setTimeout` for sequencing VS Code operations"). While this is a test (not extension code), it introduces timing sensitivity.
- **Constructor uses dependency injection** via a second options argument with factory functions (`createServerManager`, `createSseClient`, `createHttpClient`). This is a clean pattern for testability.
- No security concerns.

##### [`contribution-tracker.test.ts`](tests/unit/contribution-tracker.test.ts) (NEW — 118 lines)

- Tests [`ContributionTracker`](src/services/contributions/contribution-tracker.ts) with a fake `vscode.ExtensionContext` backed by an in-memory `Map` — clean mocking approach.
- **Test 1 — edit recording:** Verifies `recordFromPart()` correctly parses `edit` tool parts with `oldString`/`newString`, computes line-level additions/deletions diffs.
- **Test 2 — state filtering & deduplication:** Confirms non-`"completed"` tool states are ignored, and repeated part IDs are deduplicated.
- **Test 3 — clear:** Verifies `clear()` removes all stored records for a workspace.
- ⚠️ **Coverage gap:** Only tests `edit`, `write`, and `fast_edit_file` tools. If `ContributionTracker` handles other tools, they are untested.
- ⚠️ **Coverage gap:** No test for `list()` with the `limit` parameter actually limiting results.
- No security concerns. Clean, well-structured unit tests.

#### Outside kilo-vscode

##### kilo-gateway changes

**[`profile.ts`](../../packages/kilo-gateway/src/api/profile.ts) — new [`fetchExtensionSettings()`](../../packages/kilo-gateway/src/api/profile.ts) function**
- Adds an authenticated fetch to `${KILO_API_BASE}/api/extension-settings` that returns `{ organization?: unknown; user?: unknown }`.
- Properly requires `token` parameter (non-optional), passes `Authorization: Bearer` header, optional `x-kilocode-organizationid` header.
- Return type uses `unknown` for both fields — safe against type confusion, but means consumers must validate at runtime.
- No security concerns — standard authenticated API fetch pattern matching existing functions in the file.

**[`remote-sessions.ts`](../../packages/kilo-gateway/src/api/remote-sessions.ts) (NEW — 91 lines)**
- Implements a generic [`trpcGet()`](../../packages/kilo-gateway/src/api/remote-sessions.ts) helper for tRPC GET requests with query-string `input` serialization.
- [`fetchRemoteSessions()`](../../packages/kilo-gateway/src/api/remote-sessions.ts) lists cloud-synced sessions via `cliSessions.list`.
- [`fetchRemoteSessionMessages()`](../../packages/kilo-gateway/src/api/remote-sessions.ts) fetches session messages via a two-step process: first gets a blob URL via `cliSessions.get`, then fetches the blob URL directly.
- ⚠️ **Security concern — blob URL fetch has no auth:** [`fetchRemoteSessionMessages()`](../../packages/kilo-gateway/src/api/remote-sessions.ts:80) fetches `data.ui_messages_blob_url` with a bare `fetch(blobUrl)` — no `Authorization` header. This is likely intentional (pre-signed URL pattern), but the blob URL origin is not validated. If the tRPC API were compromised or returned a malicious URL, this would fetch from an arbitrary origin. Low risk since the URL comes from a trusted authenticated API, but worth noting.
- ⚠️ **Return type concern:** `fetchRemoteSessionMessages()` returns `unknown[]` — consumers must validate the shape. This is acceptable for a gateway layer but shifts validation burden downstream.

**[`routes.ts`](../../packages/kilo-gateway/src/server/routes.ts) — 3 new gateway endpoints**
- **New helper functions:** [`getToken(auth)`](../../packages/kilo-gateway/src/server/routes.ts) and [`getOrganizationId(auth)`](../../packages/kilo-gateway/src/server/routes.ts) extract credentials from the auth object. Both use `any` type — not ideal but consistent with the existing route handler pattern using `c: any`.
- ⚠️ **New auth type `wellknown`:** `getToken()` handles `auth.type === "wellknown"` returning `auth.token`. This is a new auth type not present in the original code. Need to verify this is an established auth type in the gateway framework, not something introduced by this PR that could weaken authentication.
- **`GET /extension-settings`** — Proxies to [`fetchExtensionSettings()`](../../packages/kilo-gateway/src/api/profile.ts). Auth-gated via `Auth.get("kilo")`. Returns org/user settings. No input validation needed (no user-supplied params beyond auth). ✅ Safe.
- **`GET /remote-sessions`** — Proxies to [`fetchRemoteSessions()`](../../packages/kilo-gateway/src/api/remote-sessions.ts). Auth-gated. Query param `limit` validated via Zod schema (`z.coerce.number().int().min(1).max(100).optional()`). ✅ Safe — proper input validation.
- **`GET /remote-sessions/:sessionID/messages`** — Proxies to [`fetchRemoteSessionMessages()`](../../packages/kilo-gateway/src/api/remote-sessions.ts). Auth-gated. Param `sessionID` validated as non-empty string. ✅ Safe.
- **Refactor of existing `/notifications` route** — Now uses the new `getToken()`/`getOrganizationId()` helpers instead of inline logic. Functionally equivalent, good DRY improvement.
- All three new routes follow the same authenticated pattern as existing routes: `Auth.get("kilo")` → check token → proceed. No auth bypass. No new unauthenticated endpoints.
- ⚠️ **No rate limiting** on new endpoints — same as existing endpoints, but worth noting since `remote-sessions` could potentially be expensive.

##### kilo-ui CSS

**[`vscode-bridge.css`](../../packages/kilo-ui/src/styles/vscode-bridge.css) — typography variable additions**
- Adds CSS custom properties for font families, sizes, weights, and line heights to the `html[data-theme="kilo-vscode"]` scope.
- Bridges VS Code's `--vscode-font-family`, `--vscode-editor-font-family`, `--vscode-font-size`, and `--vscode-font-weight` to kilo-ui's `--font-family-sans`, `--font-family-mono`, `--font-size-*`, `--font-weight-*`, and `--line-height-*` tokens.
- Uses `calc()` with relative multipliers for `--font-size-small` (0.85×), `--font-size-large` (1.15×), `--font-size-x-large` (1.35×) — sensible scaling.
- Includes `--font-feature-settings` and `--font-variation-settings` properties set to `normal` — standard typography reset.
- No security concerns. Pure CSS variable bridging with sensible fallback values. No `url()`, no `@import`, no external resources.

##### bun.lock

- ~1,552 lines changed — substantial lockfile update.
- **Notable new direct dependencies:** `mermaid` (^11.12.0), `tar-fs` (3.1.1), `yaml` (2.8.2), `@vscode/vsce` (^3.7.1)
- **`@types/vscode` downgraded:** from `^1.109.0` to `^1.107.0` — this aligns with the minimum VS Code version in `package.json` engines field. Makes sense.
- **Large transitive dependency trees added:** `mermaid` pulls in `@mermaid-js/parser`, `chevrotain`, `langium`, and `@braintree/sanitize-url`. `@secretlint/*` packages also added (likely for another package in the monorepo).
- ⚠️ **`mermaid` is a large dependency** with a significant attack surface (parses arbitrary diagram markup). Should verify it's needed in kilo-vscode or if it's for another package.
- ⚠️ **`tar-fs` handles tar archive extraction** — potential for path traversal if misused, but at version 3.1.1 it has built-in protections. Verify its purpose.
- No obviously malicious or suspicious new packages. All additions appear to be well-known npm packages with established maintainers.

**Bundle 7+8 Summary:** Tests are well-structured with clean mocking patterns but have notable **coverage gaps** (no error/reconnection testing in connection-service, no limit-parameter testing in contribution-tracker). The gateway changes add 3 new **properly auth-gated** endpoints (`/extension-settings`, `/remote-sessions`, `/remote-sessions/:sessionID/messages`) with appropriate input validation via Zod schemas — **no auth bypass detected**. The `remote-sessions.ts` blob URL fetch lacks origin validation (low risk). The `getToken()` helper introduces a `wellknown` auth type that should be verified as pre-existing in the framework. CSS changes are pure typography variable bridging with no security implications. The lockfile adds `mermaid` (large dep) and `tar-fs` (archive handling) which should be verified as intentionally needed. **No blocking security issues, but the `wellknown` auth type and blob URL fetching pattern warrant confirmation.**
