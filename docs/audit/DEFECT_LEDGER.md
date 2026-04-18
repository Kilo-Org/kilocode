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

## Next ID: D-013

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
