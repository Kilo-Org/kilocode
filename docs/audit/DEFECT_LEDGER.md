# Defect Ledger

> **Release:** v7.2.14+full-cockpit
> **Branch:** feat/azure-voice-studio
> **Last updated:** 2026-04-18

## Rules

1. **Fixer != Closer.** The agent that fixes a defect may NOT be the agent that closes it. A separate confirmer must rerun the proof and a challenger must break-test before the lead auditor closes.
2. **No defect is closed without evidence.** The Evidence column must contain a path to a file in `docs/audit/EVIDENCE/` or an inline proof before status can move to Closed.
3. **Severity levels:** Low, Medium, High, Critical.
4. **Status lifecycle:** Open -> In Progress -> Fixed -> Verified -> Closed. A defect may also be Reopened from any status except Open.
5. **All defects must reference at least one feature in the Feature Truth Matrix** (by block/phase).
6. **Critical defects block release.** No release verdict can be PASS while any Critical defect is Open, In Progress, or Fixed (must reach Verified or Closed).

## Severity Definitions

| Severity | Definition | Release Impact |
|----------|------------|----------------|
| Critical | Feature completely broken, data loss, security vulnerability | Blocks release |
| High | Feature partially broken, major workflow interrupted | Blocks release unless mitigated |
| Medium | Feature works but with incorrect behavior, cosmetic data issue | Does not block release if documented |
| Low | Minor cosmetic, typo, non-functional issue | Does not block release |

## Defect Table

| ID | Subsystem | Severity | Symptom | Root Cause | Status | Fix | Evidence | Owner | Closer |
|----|-----------|----------|---------|------------|--------|-----|----------|-------|--------|
| D-001 | Routing (D/48) | Medium | SiliconFlow API endpoint was `cloud.siliconflow.com` (dashboard URL, not API) | `RoutingService.ts:174` used `cloud.siliconflow.com` which is the docs/dashboard URL. Correct API is `api.siliconflow.com/v1` (international). | Fixed | Changed `RoutingService.ts` to `api.siliconflow.com/v1`. Updated `providers.yaml` to match. | `RoutingService.ts:174` + `providers.yaml` updated | Builder | Pending Confirmer |

| D-002 | Hermes (I/71) | Medium | HermesPipeline not disposed on extension deactivation — SSE connections leak | `extension.ts` line 60: `hermesPipeline` implements `vscode.Disposable` but was never pushed to `context.subscriptions`. SSE subscriptions in `this.subs` not cleaned up on deactivate. | Fixed | Added `context.subscriptions.push(hermesPipeline)` after line 60 in extension.ts | `extension.ts:61` | Builder | Pending Confirmer |

| D-003 | VPS (B/31) | High | 4 VPS reverse proxy message routes unreachable — KiloProvider switch missing cases | `KiloProvider.ts` VPS fall-through block (lines 1143-1151) missing `vpsGetReverseProxyConfigs`, `vpsAddReverseProxyConfig`, `vpsRemoveReverseProxyConfig`, `vpsTestReverseProxyConfig`. Handlers exist in VPSService.ts but messages silently dropped. | Fixed | Added 4 case labels to VPS fall-through block in KiloProvider.ts | `KiloProvider.ts:1152-1155` | Builder | Pending Confirmer |
| D-004 | ZeroClaw (C/43) | High | 2 ZeroClaw message routes completely unimplemented — task result and artifact collection | `KiloProvider.ts` has no case for `zeroClawGetTaskResult` or `zeroClawCollectArtifacts`. Methods exist on ZeroClawService (`getTaskResult:287`, `collectArtifacts:312`) but never called from message handler. | Fixed | Added 2 new case blocks after zeroClawGetHistory in KiloProvider.ts | `KiloProvider.ts:1192-1202` | Builder | Pending Confirmer |

| D-005 | VPS (B/27) | High | VPS casing mismatch: VPSTab sends `requestVpsServers` but KiloProvider case was `requestVPSServers` — initial server list load broken | VPSTab.tsx:370 sends lowercase, KiloProvider:1143 expects uppercase. VPSService.handleMessage also uses lowercase. | Fixed | Added `case "requestVpsServers":` alias in KiloProvider fall-through block | `KiloProvider.ts:1144` | Builder | Pending Confirmer |
| D-006 | SSH (A/17) | High | KiloProvider SSH responses use wrong type names — `sshProfiles` instead of `sshProfilesLoaded`, `sshSessions` instead of `sshSessionsUpdated` | SSHTab.tsx listens for `sshProfilesLoaded` and `sshSessionsUpdated` but KiloProvider emitted `sshProfiles` and `sshSessions`. Data never reached the tab. | Fixed | Changed all `sshProfiles` → `sshProfilesLoaded` and `sshSessions` → `sshSessionsUpdated` in KiloProvider.ts | `KiloProvider.ts:1083-1102` | Builder | Pending Confirmer |
| D-007 | Routing (D/45) | Critical | Routing tab entirely non-functional — expects 6 response types none of which were emitted | RoutingTab.tsx listens for `routingProvidersLoaded`, `routingTracesLoaded`, `routingHealthLoaded`, `routingConfigLoaded`, `routingTestResult`, `routingKeyConfigured`. KiloProvider emitted `routingState`, `routingTraces`, `routingHealth` — names never matched. | Fixed | Rewrote all Routing response emissions in KiloProvider to emit the names the tab expects with split payloads | `KiloProvider.ts:1206-1249` | Builder | Pending Confirmer |
| D-008 | Memory (E/53) | High | Memory tab response type names mismatched — 6 names wrong | KiloProvider emitted `memoryStatus`/`memoryRecallResults`/`memoryWriteConfirmed`/`memoryHistory` but MemoryTab expects `memoryStatusLoaded`/`memoryRecallResult`/`memoryWriteResult`/`memoryHistoryLoaded`. Also `memoryConnectionChanged` and `memoryPermissionChanged` never emitted. | Fixed | Updated all Memory response type names in KiloProvider; added `memoryConnectionChanged` on reconnect and `memoryPermissionChanged` on setPermission | `KiloProvider.ts:1256-1280` | Builder | Pending Confirmer |
| D-009 | ZeroClaw (C/35) | High | ZeroClaw tab response type names mismatched — `zeroClawTasks` instead of `zeroClawTasksLoaded`, `zeroClawHistory` instead of `zeroClawHistoryLoaded` | ZeroClawTab.tsx listens for `zeroClawTasksLoaded`/`zeroClawTaskUpdated`/`zeroClawTaskRetried`/`zeroClawHistoryLoaded` but KiloProvider emitted `zeroClawTasks`/`zeroClawHistory`. | Fixed | Changed all ZeroClaw response type names in KiloProvider; added `zeroClawTaskUpdated` on submit and `zeroClawTaskRetried` on retry | `KiloProvider.ts:1162-1204` | Builder | Pending Confirmer |
| D-010 | Training (F/59) | High | 4 Training request routes missing from KiloProvider — trainingRemoveDataset, trainingResumeJob, trainingCancelJob, trainingBrowsePath silently dropped | TrainingTab.tsx sends these 4 messages but no case existed in KiloProvider. TrainingService has all methods (`removeDataset`, `resumeJob`, `cancelJob`). trainingBrowsePath needed VS Code file dialog. | Fixed | Added 4 case blocks with service calls and state responses. trainingBrowsePath uses `vscode.window.showOpenDialog`. | `KiloProvider.ts:1321-1344` | Builder | Pending Confirmer |
| D-011 | Training (F/65) | Medium | Training compare response type mismatch — `trainingComparison` instead of `trainingCompareResult` | KiloProvider emitted `trainingComparison` but TrainingTab expects `trainingCompareResult`. | Fixed | Changed type string from `trainingComparison` to `trainingCompareResult` in KiloProvider | `KiloProvider.ts:1350` | Builder | Pending Confirmer |
| D-012 | VPS (B/31) | Low | V4SubsystemMessage union missing 2 types emitted by VPSService: `vpsDeployPreflightFailed` and `vpsReverseProxyConfigsLoaded` | VPSService.handleMessage emits these types at runtime but they were absent from the union type, making them untyped in the webview. | Fixed | Added both types to V4SubsystemMessage union and cleaned up stale type aliases | `messages.ts:1644-1648` | Builder | Pending Confirmer |

| D-013 | VPS (B/27) | Medium | VPS `vpsServerAdd` and `vpsServerRemove` handlers lack try/catch — TypeError on malformed input | `VPSService.ts` lines 1218-1233: only handlers in `handleMessage` without try/catch. If `message.server` is undefined, `addOrUpdateServer(undefined)` throws TypeError on `.id` access. All other branches are wrapped. | Fixed | Wrapped both cases in try/catch with input validation, error logging, and `vpsError` response | `VPSService.ts:1218-1246` | Builder | Pending Confirmer |
| D-014 | Training (F/59) | Medium | `validateJsonl` reads entire file into memory with `readFileSync` — OOM risk on large datasets up to 10GB max | `TrainingService.ts` line 397: `fs.readFileSync(path, "utf-8")` loads full file. Combined with 10GB max dataset limit, this could exhaust Node.js heap. Same issue at line 438 for CSV validation. | Open | Should use streaming line-by-line reader instead of readFileSync | -- | -- | -- |
| D-015 | Governance (H/68) | Medium | `tierLevel()` has no default case — invalid tier name returns `undefined`, causing NaN in comparisons | `GovernanceService.ts` line 288: exhaustive switch with no default. If an invalid tier name reaches this function, it returns `undefined` which becomes `NaN` in numeric comparisons. | Open | Add default case returning 0 or throw | -- | -- | -- |
| D-016 | Governance (H/68) | Medium | Evidence bundles stored only in-memory Map — lost on extension restart | `GovernanceService.ts` line 993: `createEvidenceBundle()` stores in `Map` but never persists to disk. All evidence is lost when the extension deactivates/reloads. | Open | Should persist to `.kilo/evidence.json` or globalState | -- | -- | -- |

| D-017 | Memory (E/54) | Medium | `memoryRecall` in KiloProvider passes bare string instead of options object — project filter silently ignored | `KiloProvider.ts` line 1257: `recall(query, message.project)` but `recall()` expects `(query, { project })`. The string is accessed as `.project` which returns `undefined`, so the project filter is silently dropped. | Fixed | Changed to `recall(message.query, { project: message.project })` | `KiloProvider.ts:1257` | Builder | Pending Confirmer |
| D-018 | Memory (E/55) | High | `memoryWrite` in KiloProvider has no try/catch — throws on invalid input leave webview hanging | `KiloProvider.ts` lines 1261-1265: `writeMemory()` throws on empty summary, invalid factType, invalid scope. No catch block. Webview never receives failure response. | Fixed | Wrapped in try/catch, sends `memoryWriteResult` with `success: false` and error message on failure | `KiloProvider.ts:1261-1269` | Builder | Pending Confirmer |

| D-019 | ZeroClaw (C/35) | High | ZeroClaw submit throws on invalid input (empty description, invalid riskLevel) — webview hangs | `KiloProvider.ts:1167-1171`: `zeroClawSubmitTask` case had no try/catch. `ZeroClawService.submit()` throws on validation failure. The throw propagates as unhandled Promise rejection; webview never gets a response. | Fixed | Wrapped in try/catch, sends `zeroClawError` with error message on failure | `KiloProvider.ts:1167-1175` | Builder | Pending Confirmer |
| D-020 | ZeroClaw (C/40) | Medium | ZeroClaw retry budget exhaustion produces no user feedback | `ZeroClawService.retry()` returns `undefined` when budget (3/3) is exhausted. KiloProvider silently refreshes task list. No warning shown. | Fixed | Added `vscode.window.showWarningMessage` when `retry()` returns `undefined`. Also wrapped in try/catch. | `KiloProvider.ts:1178-1192` | Builder | Pending Confirmer |
| D-021 | Memory (E/54) | High | `memoryRecall` case has no try/catch — undefined query causes TypeError, webview hangs | `KiloProvider.ts:1255-1259`: If `message.query` is undefined/null, `query.trim()` in MemoryService throws TypeError. No catch. Webview never gets `memoryRecallResult`. | Fixed | Wrapped in try/catch, returns `status: "failed"` recall result on error | `KiloProvider.ts:1257-1264` | Builder | Pending Confirmer |
| D-022 | Memory (E/57) | Medium | `memoryRunDiagnostics` case has no try/catch — unexpected throw leaves webview waiting | `KiloProvider.ts:1286-1290`: `runDiagnostics()` is async and could reject. No catch block. | Fixed | Wrapped in try/catch, sends diagnostic result with `passed: false` on error | `KiloProvider.ts:1290-1298` | Builder | Pending Confirmer |
| D-023 | Training (F/61) | High | Training `launchJob` case has no try/catch — 3 throw paths (unvalidated dataset, GPU quota, memory limit) all crash KiloProvider | `KiloProvider.ts:1315-1319`: `launchJob()` throws on unvalidated dataset, GPU quota exceeded, or memory over limit. Webview hangs. | Fixed | Wrapped in try/catch, sends `trainingError` message on failure | `KiloProvider.ts:1319-1327` | Builder | Pending Confirmer |
| D-024 | Training (F/66) | High | Training `exportModel` case has no try/catch — throws on incomplete job or invalid format | `KiloProvider.ts:1361-1365`: `exportModel()` calls `validateExportOptions()` which throws on incomplete job or invalid format. Webview hangs. | Fixed | Wrapped in try/catch, sends `trainingError` message on failure | `KiloProvider.ts:1368-1376` | Builder | Pending Confirmer |
| D-025 | Training (F/64) | High | Training `resumeJob` case has no try/catch — throws on non-paused job | `KiloProvider.ts:1325-1329`: `resumeJob()` throws if job status is not "paused". Webview hangs. | Fixed | Wrapped in try/catch, sends `trainingError` message on failure | `KiloProvider.ts:1329-1337` | Builder | Pending Confirmer |
| D-026 | Training (F/65) | High | Training `compareRuns` case has no try/catch — throws on invalid job IDs | `KiloProvider.ts:1355-1359`: `compareRuns()` throws if jobA or jobB not found. Webview hangs. | Fixed | Wrapped in try/catch, sends `trainingError` message on failure | `KiloProvider.ts:1362-1370` | Builder | Pending Confirmer |
| D-027 | Training (F/61) | Medium | Training `cancelJob` silently corrupts completed job — no status guard + no try/catch | `TrainingService.ts:593`: `cancelJob()` unconditionally sets `status = "failed"` regardless of current status. Cancelling a completed job silently overwrites it to failed. KiloProvider case also had no try/catch. | Fixed | Added status guard `if (completed\|failed) throw` in TrainingService. Wrapped KiloProvider case in try/catch. | `TrainingService.ts:596-598`, `KiloProvider.ts:1339-1347` | Builder | Pending Confirmer |
| D-028 | Governance (H/68) | Medium | `governanceSetTier` accepts arbitrary tier names — stores garbage data in tier assignments | `KiloProvider.ts:1378`: Passes `message.tier` directly to `setUserTier()` with no runtime validation. An invalid tier name like "superduper" gets stored, then `getUserTier()` falls back to observer tier. Data integrity issue. | Fixed | Added runtime validation of tier name against `["observer", "operator", "admin", "superadmin"]`. Invalid tier posts `governanceError`. | `KiloProvider.ts:1381-1386` | Builder | Pending Confirmer |
| D-029 | KiloProvider (all) | Critical | No top-level error boundary in message handler — any unhandled throw produces an unhandled Promise rejection | `KiloProvider.ts:604-1451`: The `onDidReceiveMessage` async callback has no outer try/catch around the switch. Any service method that throws without a per-case catch becomes an unhandled rejection. Webview hangs waiting for a response. | Fixed | Wrapped entire switch in try/catch with `console.error` logging and `v4Error` fallback message to webview | `KiloProvider.ts:604-1458` | Builder | Pending Confirmer |

## Next ID: D-030

## Cross-Reference

| Defect ID | Truth Matrix Block | Truth Matrix Phase | Feature |
|-----------|-------------------|-------------------|---------|
| D-001 | D | 48 | SiliconFlow fallback |
| D-002 | I | 71 | Hermes pipeline disposal |
| D-003 | B | 31 | VPS reverse proxy routes |
| D-004 | C | 43 | ZeroClaw task result + artifacts |
| D-005 | B | 27 | VPS casing mismatch |
| D-006 | A | 17 | SSH response type names |
| D-007 | D | 45 | Routing tab non-functional |
| D-008 | E | 53 | Memory response type names |
| D-009 | C | 35 | ZeroClaw response type names |
| D-010 | F | 59 | Training missing routes |
| D-011 | F | 65 | Training compare response name |
| D-012 | B | 31 | VPS missing union types |
| D-013 | B | 27 | VPS server add/remove try/catch |
| D-014 | F | 59 | Training OOM on large dataset validation |
| D-015 | H | 68 | Governance tierLevel no default |
| D-016 | H | 68 | Governance evidence not persisted |
| D-017 | E | 54 | Memory recall project filter ignored |
| D-018 | E | 55 | Memory write uncaught throw |
| D-019 | C | 35 | ZeroClaw submit validation crash |
| D-020 | C | 40 | ZeroClaw retry budget silent |
| D-021 | E | 54 | Memory recall undefined query crash |
| D-022 | E | 57 | Memory diagnostics unhandled throw |
| D-023 | F | 61 | Training launch unhandled throws |
| D-024 | F | 66 | Training export unhandled throws |
| D-025 | F | 64 | Training resume unhandled throw |
| D-026 | F | 65 | Training compare unhandled throws |
| D-027 | F | 61 | Training cancelJob state corruption |
| D-028 | H | 68 | Governance setTier no validation |
| D-029 | All | All | No top-level error boundary |
