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

## Next ID: D-002

## Cross-Reference

| Defect ID | Truth Matrix Block | Truth Matrix Phase | Feature |
|-----------|-------------------|-------------------|---------|
| D-001 | D | 48 | SiliconFlow fallback |
