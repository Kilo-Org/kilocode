# Non-IDE Completion Inventory Audit — OpenCode v2 Baseline

**Date:** 2026-09-05
**Origin / Base Provenance:**
- Kilo v1 `origin/main` exact SHA: `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`
- v2 HEAD exact SHA: `82040801cd253665d2785c290031d307a18a0d64`
- Pinned upstream v2 baseline SHA: `76dbaf20adbd43fd208a00ef3cda4a51e125a234`
- Canonical Plan: `plans/kilo-opencode-v2-issue-13750.md` (read-only; canonical plan untouched)

---

## 1. Inventory Baseline and Objective

- **Target:** **Maximum verifiable non-IDE port completion**, with honest boundaries, missing-port verification, and zero inflated row closure claims.
- **Frozen denominator:** **43 active capability rows** (44 including obsolete Console).
- **Currently accepted:** **26 rows** (**60.5%**).
- **Unresolved rows:** **17 active rows**.

### Classification Categories
- `reusable`: v2 already supplies the behavior; wiring/policy verification only.
- `delta`: v2 supplies base engine; bounded Kilo policy/schema/host adapter needed.
- `seamblocked`: Missing an upstream or host public seam; requires shared hook or new seam.
- `productdecision`: Blocked on explicit product/brand decisions (e.g. naming, distribution channels).
- `deployedgate`: Blocked on live backend services, deployed token contracts, or cloud viewer compatibility.
- `ide-bound`: Dedicated IDE client feature (VS Code extension / JetBrains plugin); excluded from non-IDE CLI scope.

---

## 2. Exhaustive Classification of All 17 Unresolved Rows

| Row # | Capability | Owner | Phase | Status | Classification | Precise Blockers & Acceptance Scope |
|---|---|---|---|---|---|---|
| 5 | Gateway catalog, BYOK, org routing (`kilo-gateway`) | 3 plugin + host | 1, 4 | in-progress | `delta` + `deployedgate` | Active writer advancing protocol transport. **Blocker:** Gateway prompt-policy gap (instructions/system prompt selector rules) and real-catalog `autoRouting` availability remain open beyond protocol fixes. |
| 8 | Session share / unshare / fork-from-share | 3 plugin + backend | 1 | in-progress | `deployedgate` | Local RPC/TUI done. **Blocker:** Cloud `share_token` contract, v2 web viewer compatibility (v2 embedded parts vs legacy viewer), team org UUID propagation, and post-share sync. |
| 12 | Sandbox PTY / MCP / git spawn policy | 2 host | 3 | not-started | `seamblocked` | macOS seatbelt & Linux bwrap tool shells done. **Blocker:** Host-level PTY multiplexing, MCP process isolation, and independent git spawn confinement require host process supervision. |
| 19 | Settings scopes and remaining Kilo-only fields | 2 host + UI | 4 | started | `delta` | TUI presentation persistence in `tui.json` done. **Blocker:** Project vs global scope switching, and auditing/mapping remaining fields from community PR #12502. |
| 22 | CLI TUI remainder (sidebar, built-in agents, Plan) | 2 host + 3 plugin | 4 | in-progress | `delta` | Custom Plan & Code rename done. **Blocker:** Built-in agent Explore hardening (`exploreBash`), Ask diagram/prompt policy; sidebar background process supervision (`sidebar-background-processes.tsx`), PR link (`sidebar-pr.tsx`), and throughput/model benchmarks. |
| 28 | `/remote` | 2 + Gateway | 4 | started | `delta` + `deployedgate` | Loopback control adapter done. **Blocker:** Deployed relay consumer expects v1 event shapes (`event.properties`), blocking transcript relay. Public client gaps (`list_models`, attachments) are implementable deltas. |
| 30 | Updater / update channel / packaging | 2 host | 4 | not-started | `productdecision` | **Blocker:** Product choices on release binary identity (`kilo` vs preview `kilo2`), packaging target (standalone Bun executable vs launcher), and updater channels (`latest`, npm, homebrew). |
| 33 | `kilo.jsonc` key mapping (Kilo-only keys) | 2 host | 6 | started | `delta` | Upstream `ConfigMigrateV1` already migrates `autoshare`, `tools` (to `shell`/`edit`), and `compaction`. `privacy_mode` and `hide_prompt_training_models` are mapped. **Blocker:** Unmapped Kilo keys (`indexing`, `sandbox`, `commit_message`) must be fail-closed refused with clear diagnostics without data corruption; refusal is not full mapping. |
| 35 | VS Code sidebar chat | 2 Protocol client | 5 | not-started | `ide-bound` | Excluded from non-IDE completion. |
| 36 | VS Code editor tabs | 2 client | 5 | not-started | `ide-bound` | Excluded from non-IDE completion. |
| 37 | Agent Manager | 2 client | 5 | not-started | `seamblocked` / client | Multi-worktree orchestration client. Depends on host multi-session/worktree lifecycle. |
| 38 | VS Code settings webview | 2 client | 5 | not-started | `ide-bound` | Excluded from non-IDE completion. |
| 39 | Inline autocomplete / FIM | 2 client | 5 | unknown | `ide-bound` | Excluded from non-IDE completion. |
| 40 | Code actions, enhance prompt, git commit generation | 2 client | 5 | unknown | `ide-bound` + `delta` | Bundles editor code actions with prompt/commit generation. Editor code actions are IDE-bound. Enhance prompt / commit generation alone cannot close the row. |
| 41 | Task timeline, diff viewer | 2 client | 5 | not-started | `reusable` (TUI) / `ide-bound` | v2 TUI has native diff viewer; Task timeline is an IDE webview component. |
| 42 | Voice / speech-to-text | unknown | 5 | unknown | `ide-bound` | Pure VS Code audio capture & Whisper transcription client. |
| 43 | JetBrains plugin | 2 client | 5 | not-started | `ide-bound` | Excluded from non-IDE completion. |

---

## 3. Scope Verification & De-duplication

### A. Config Mapping (`kilo.jsonc`, Row 33)
- Verification against upstream `packages/core/src/v1/config/migrate.ts`:
  - `ConfigMigrateV1.migrate()` already maps:
    - `autoshare: true` $\to$ `share: "auto"`
    - `tools` $\to$ `permissions` using normalized actions: `bash` $\to$ `shell` (native v2 permission vocabulary), `write`/`patch` $\to$ `edit`, `task` $\to$ `subagent`.
    - `compaction` $\to$ `compaction: { auto, prune, keep: { tokens }, buffer }`
  - Re-implementing these in the Kilo adapter would be duplicate code.
  - What remains: Kilo-only keys unknown to `ConfigV1.Info` (such as `indexing`, `sandbox`, `commit_message`). Refusing unmapped keys fail-closed is safe and required, but does not constitute complete feature mapping of those subsystems.

### B. Gateway Catalog & Policy (Row 5)
- Active writer is implementing protocol transport and routed models.
- **Open gap:** Prompt-policy parity (system prompt construction, prompt-selector rules, model family restrictions) and verified real-catalog `autoRouting` metadata across personal/team accounts remain unclosed.

### C. CLI TUI Remainder (Row 22)
- Reopened for built-in agents and sidebar parity.
- Custom Plan workflow (`plan-policy.ts`) and Code display rename are verified.
- **Open gaps:**
  1. Built-in agents: Explore hardening (v1 `exploreBash` allowlist, denying `gh` and `find`), Ask prompt/diagram guidance.
  2. Sidebar: Process supervision (`sidebar-background-processes.tsx`), PR link/status (`sidebar-pr.tsx`), and throughput/model benchmark metrics.

---

## 4. ONE Recommended Implementable Slice: Remote Session Public Interface Delta (Row 28)

### Target Capability
Implement missing public client operations in `packages/kilo-cli/src/remote-session.ts` and `remote-protocol.ts`:
1. **`list_models` command translation:**
   - **v1 Source:** `packages/opencode/src/kilo-sessions/remote-sender.ts` lines 867–896 (`RemoteModelCatalog.build({ providers, defaultModel, session })`).
   - **v2 Public Seam:** `client.model.list({ location })` and `client.model.default({ location })` on `OpenCodeClient`.
   - **Implementation:** Expand `RemoteSessionConnection.client` to include `"model"`. When `msg.command === "list_models"` arrives, fetch models via public client, format response with `protocolVersion: 1`, `connected`, and default model mapping.
2. **Multipart prompt attachment translation:**
   - **v1 Source:** `send_message` materializes file parts before admission.
   - **v2 Public Seam:** `client.session.prompt` natively accepts prompt attachments and data URLs.
   - **Implementation:** Expand `RemoteTextMessageSchema` to accept text and data URL / file attachment parts, mapping them directly to `client.session.prompt({ sessionID, text, attachments })`.

### Why This Slice
- **Strictly Non-overlapping:** No active writers touch `packages/kilo-cli/src/remote-session.ts`, `packages/kilo-cli/src/remote-protocol.ts`, or `packages/kilo-cli/test/remote-session.test.ts`.
- **Public Seams Only:** Uses only standard `@opencode-ai/client` endpoints (`client.model.list`, `client.session.prompt`). No Core imports or shared hooks.
- **Verifiable Locally:** Can be fully tested using loopback WebSocket fixtures in `test/remote-session.test.ts` without network, live accounts, or paid inference.
- **Honest Boundary:** Explicitly records that this slice does **NOT** close Row 28 (which remains `started` / `deployedgate` until the deployed transcript forwarder contract is verified).
