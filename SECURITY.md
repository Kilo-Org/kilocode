# Security Review: PR #11712

Reviewed the complete `main...HEAD` diff for PR #11712, including the new Marketplace ingestion/install code, Project Stack detection/planning/runtime/store services, HTTP routes, VS Code webview, console UI, generated API surface, and relevant surrounding authentication, workspace-routing, CORS, configuration, and filesystem code.

## Threat Model Overview

### Assets

- Project files and project-local Kilo configuration under `.kilo/`.
- MCP configuration, including executable commands, remote endpoints, headers, OAuth fields, and environment-variable references.
- Installed skill content, which becomes agent instructions and may influence later filesystem, shell, network, and secret-related actions.
- Local host availability and the confidentiality of workspace technology choices and filenames.

### Trust Boundaries

- **Workspace -> extension/backend:** a cloned or otherwise untrusted workspace controls filesystem shape, dependency manifests, existing `.kilo` state, and races involving paths under the project.
- **Marketplace -> backend/UI:** Marketplace manifests, item descriptions, trust-like metadata, MCP templates, prerequisites, warnings, artifact URLs, sizes, and digests originate outside the local trust boundary.
- **Webview/console -> extension/backend:** webview messages and HTTP payloads request scans and privileged project mutations.
- **HTTP client -> local server:** callers select a workspace directory and can invoke detect, preview, and apply routes; authorization is conditional on server configuration.
- **Installed resource -> agent/runtime:** skills become instructions and MCP definitions can start local commands or connect to remote services with the user's environment.

### Security Properties Expected

- Installation must be an explicit, accurately informed decision for a trusted workspace and immutable reviewed plan.
- Marketplace identity, trust, command behavior, and artifact integrity must not be self-asserted by the same untrusted response.
- Filesystem reads/writes/removals must remain within the selected worktree despite traversal, links, and races.
- Sensitive values must not enter drafts, receipts, UI messages, logs, telemetry, or persisted configuration; environment references should remain references.
- Scans and inventory calculations must be bounded against hostile workspace contents.
- Mutating HTTP operations must require authorization and resist cross-origin invocation.

## Findings

### SECURITY-001: Project Stack performs privileged scans and installs in VS Code Restricted Mode

- **Severity:** High
- **Files/lines:** `packages/kilo-vscode/src/StackPanelProvider.ts:42`, `packages/kilo-vscode/src/StackPanelProvider.ts:198`, `packages/kilo-vscode/src/StackPanelProvider.ts:220`, `packages/kilo-vscode/src/extension.ts:298`, `packages/kilo-vscode/src/extension.ts:370`
- **Attack/precondition:** A user opens an untrusted repository in VS Code Restricted Mode, opens or restores the Project Stack panel, and uses auto-detect or Apply. The repository may have been cloned from an attacker or supplied as an archive.
- **Evidence:** Panel creation, deserialization, backend connection, detection, and `stackApply` dispatch do not check `vscode.workspace.isTrusted`. The command is registered unconditionally, and a serialized panel is restored after restart. Apply installs skill instructions and writes enabled MCP definitions that may later execute local commands or receive environment-based credentials.
- **Impact:** Restricted Mode does not protect the user from this feature's privileged behavior. An untrusted workspace can influence detection and the proposed resources, after which the feature writes agent instructions and executable MCP configuration into that workspace. This weakens VS Code's primary trust boundary and can turn a social-engineering click into later code execution or secret exposure.
- **Remediation:** Gate panel backend connection, detection, preview, and especially Apply on `vscode.workspace.isTrusted`; disable or replace the UI with a trust-required state while restricted. Re-check trust immediately before mutation, handle trust revocation/project changes, and avoid restoring into an operational state until trust is granted. Declare and test the extension's `untrustedWorkspaces` behavior explicitly.

### SECURITY-002: Marketplace authenticity is based on TLS and same-source digests, not a trusted signature

- **Severity:** High
- **Files/lines:** `packages/opencode/src/kilocode/marketplace/service.ts:357`, `packages/opencode/src/kilocode/marketplace/service.ts:378`, `packages/opencode/src/kilocode/marketplace/service.ts:487`, `packages/opencode/src/kilocode/marketplace/service.ts:608`, `packages/opencode/src/kilocode/marketplace/schema.ts:107`, `packages/opencode/src/kilocode/marketplace/manifest.ts:33`
- **Attack/precondition:** The Marketplace origin, its publishing pipeline/account, a configured custom Marketplace endpoint, or the first network response is compromised. A fresh client has no prior cache history for the affected revision/item.
- **Evidence:** Manifest acceptance validates schema, revision monotonicity, and local cache history, but there is no signature, pinned signing key, transparency proof, or independently trusted digest. Artifact SHA-256 and size are supplied by the same manifest that supplies the artifact URL. Mutation history only detects changes after a version/revision has already been observed locally, and the fallback legacy manifest is assembled from unsigned YAML/GitHub metadata.
- **Impact:** A compromised first response can define an arbitrary fixed local MCP command or malicious skill archive and provide a matching digest. The digest detects accidental corruption but does not establish publisher authenticity. Once applied, the MCP is enabled and the skill becomes trusted agent input, enabling code execution, prompt/instruction injection, network access, or later secret use under the user's account.
- **Remediation:** Sign canonical manifests and artifact metadata with an offline/pinned Marketplace signing key and verify signatures before caching or planning. Bind item ID, publisher identity, version, command template, artifact URL, size, and digest into the signed statement. Consider transparency/logging and key rotation. Treat cache history as rollback protection only, not authenticity.

### SECURITY-003: UI trust labels and authorization do not reflect the Marketplace item actually installed

- **Severity:** High
- **Files/lines:** `packages/opencode/src/kilocode/stack/service.ts:226`, `packages/opencode/src/kilocode/stack/service.ts:229`, `packages/opencode/src/kilocode/stack/service.ts:329`, `packages/opencode/src/kilocode/stack/service.ts:352`, `packages/opencode/src/kilocode/stack/service.ts:403`, `packages/opencode/src/kilocode/marketplace/mcp.ts:135`, `packages/kilo-vscode/webview-ui/src/components/stack/ResourceStep.tsx:247`, `packages/kilo-vscode/webview-ui/src/components/stack/ResourceStep.tsx:255`, `packages/kilo-vscode/webview-ui/src/components/stack/ResourceStep.tsx:259`, `packages/kilo-vscode/webview-ui/src/components/stack/ResourceStep.tsx:262`
- **Attack/precondition:** Marketplace metadata for an expected built-in resource ID is malicious, incorrectly classified, or taken over. The user selects the apparently curated/recommended resource and applies the plan.
- **Evidence:** Catalog joining matches only `${kind}:${id}`. The UI displays the built-in association's `trust` and `maturity` labels, while description and installation methods come from the independently supplied Marketplace item. No code compares the catalog trust claim to `item.publisher.trust`, verifies publisher identity for that resource ID, or blocks community/unverified items. Local MCP templates may contain any fixed executable and arguments as long as the executable itself has no placeholder; the review/action schema does not disclose the resolved command, environment mapping, remote URL/headers, or item publisher. Apply then writes the resolved MCP with `enabled: true`.
- **Impact:** A hostile item can inherit an "official" or "provider"-looking label from the built-in catalog and conceal the effective command behind a benign method name/description. The user's Apply decision is therefore not informed authorization for the executable configuration that is installed. This can lead directly to command execution or credential-bearing remote connections when the MCP is used.
- **Remediation:** Cryptographically bind catalog resource IDs to approved publisher identities/keys. Derive displayed trust from verified Marketplace provenance, reject mismatches, and never present built-in association trust as item trust. Before Apply, show the exact resolved executable/arguments or remote origin, environment variable names, headers with secret values redacted, publisher, digest/version, requested write capabilities, and install/remove paths. Require an additional confirmation for local commands, community/unverified publishers, or changed templates; do not enable newly installed MCPs until that authorization is recorded.

### SECURITY-004: Stack HTTP mutation and scanning are unauthenticated when the server has no password

- **Severity:** Medium (High when the server is reachable by another user/host)
- **Files/lines:** `packages/opencode/src/kilocode/server/httpapi/groups/stack.ts:122`, `packages/opencode/src/kilocode/server/httpapi/groups/stack.ts:144`, `packages/opencode/src/kilocode/server/httpapi/groups/stack.ts:165`, `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts:122`, `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts:126`, `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts:86`, `packages/opencode/src/server/routes/instance/httpapi/middleware/workspace-routing.ts:181`, `packages/opencode/src/server/cors.ts:12`
- **Attack/precondition:** `kilo serve` is running without `KILO_SERVER_PASSWORD`, and an attacker can reach it (another local process/user, a permitted localhost web origin, or a network peer when bound beyond loopback). The attacker knows or guesses a filesystem directory.
- **Evidence:** The routes include `Authorization`, but its implementation becomes a no-op when no password is configured. Workspace routing accepts the caller-controlled `directory` query/header without constraining it to a previously registered workspace. CORS permits every `http://localhost:*` and `http://127.0.0.1:*` origin, and requests without an `Origin` are accepted. The new endpoints can recursively inspect a directory and mutate `.kilo/kilo.jsonc`, skills, and MCP configuration.
- **Impact:** Reachable unauthenticated callers can use `detect` as a filesystem technology oracle and can preview/apply installs and removals in arbitrary accessible directories. Apply can configure enabled local MCP commands originating from Marketplace metadata. This materially increases the consequence of an accidentally exposed or intentionally passwordless server beyond read-only local UI access.
- **Remediation:** Require authentication for stack detect/apply regardless of the server-wide optional-auth mode, preferably with a capability scoped to an approved workspace and mutation operation. Resolve directories against an allowlisted workspace registry rather than arbitrary query input. Add same-origin/CSRF enforcement for state-changing browser requests and narrow localhost CORS to known application origins. At minimum, refuse Apply on non-loopback unauthenticated listeners and provide a clear startup/API warning. Human verification should confirm whether passwordless server access is an intentionally accepted security boundary for these new privileged routes.

### SECURITY-005: Workspace-controlled scan and inventory inputs can cause unbounded file reads

- **Severity:** Medium
- **Files/lines:** `packages/opencode/src/kilocode/stack/catalog/detect.ts:40`, `packages/opencode/src/kilocode/stack/catalog/detect.ts:187`, `packages/opencode/src/kilocode/stack/catalog/detect.ts:208`, `packages/opencode/src/kilocode/stack/catalog/detect.ts:211`, `packages/opencode/src/kilocode/stack/catalog/detect.ts:221`, `packages/opencode/src/kilocode/stack/runtime.ts:98`, `packages/opencode/src/kilocode/stack/runtime.ts:102`, `packages/opencode/src/kilocode/stack/runtime.ts:120`, `packages/opencode/src/kilocode/stack/runtime.ts:157`
- **Attack/precondition:** A workspace contains a very large `package.json`, `pyproject.toml`, or `requirements.txt`, or a project-local managed skill directory with very large/deep content. The user or an API caller invokes detect, load, preview, or apply.
- **Evidence:** Detection limits traversal to 8,000 file names and depth 8, but then reads the three dependency files as complete strings without byte limits. Inventory fingerprints every file in relevant `.kilo/skills/<id>` trees by loading each complete file into memory, with no entry, depth, per-file, or total-byte budget. Marketplace archive extraction has strong size/entry limits, but those limits do not apply after workspace contents are modified or pre-created.
- **Impact:** A malicious or accidentally huge workspace can cause high memory allocation, CPU use, event-loop stalls, or process termination. Because load/preview/apply inventory repeats fingerprinting, the condition can persistently deny use of Project Stack and potentially the shared CLI backend used by other extension features.
- **Remediation:** Add strict per-file and aggregate byte limits to detection reads, reject or truncate oversized manifests, and parse incrementally where practical. Apply entry/depth/per-file/aggregate budgets to skill fingerprinting, stream file contents into the hash instead of buffering whole files, and support cancellation/timeouts. Return a bounded diagnostic identifying the skipped resource rather than failing or exhausting the backend.

## Reviewed Areas Without Additional Findings

- Archive extraction rejects absolute/traversal paths, Windows aliases, links, duplicate entries, oversized archives, excessive entries, and non-empty destinations; extraction uses exclusive file creation and verifies the resulting tree.
- Project Stack store/runtime code checks real paths for `.kilo`, config, staging, and skills roots, rejects root symlinks, uses slug-constrained resource IDs, fingerprints before managed removal/replacement, and attempts transactional rollback.
- Sensitive MCP parameters are rejected in request drafts and represented through declared environment-variable references; no new Stack telemetry carrying detections, filenames, parameters, or secrets was identified.
- Remote MCP URLs require HTTPS (except loopback HTTP), embedded URL credentials are rejected, secret-like headers/arguments must use environment references, and control characters/placeholders are validated.
- Added SVG assets are loaded as packaged image resources under the webview CSP; no scripts, event handlers, `foreignObject`, or external image references were identified in the reviewed assets.

These positive controls do not mitigate the findings above, particularly provenance, informed authorization, workspace trust, conditional HTTP authentication, and resource-exhaustion concerns.
