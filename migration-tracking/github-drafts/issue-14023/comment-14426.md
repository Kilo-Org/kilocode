# Draft comment for #14426

> Publication note: replace `../../..` repo-relative reference to the technical note with a
> link to the merged file on `kilo-v2` at publication time (see README publication sequence).

---

Contract map and dispositions from static source, evidence for #14426. Depends on the #14425
inventory (comment there). Full per-area tables with file:line citations are in
`migration-tracking/technical-notes/cloud-agent-consumer-inventory.md` (see PR link). Source:
`Kilo-Org/cloud` @ `9a8c92ac7`, kilocode `kilo-v2` @ `1aec22c5b2`.

**Three corrections to prior assumptions:**

1. **Cancel exists server-side.** cloud-agent-next exposes `interruptSession` and
   `cancelQueuedMessage` (`router/handlers/session-management.ts:225,322`) with six in-repo
   callers. The "no cancel" gap in `cloud-cli-v2-parity.md` was client-side only — the v2 CLI can
   add cancel against an existing contract.
2. **The wrapper already runs the v2-fork CLI** (`@kilocode/cli@7.8.1`, `kilo serve` via
   `@kilocode/sdk` v1 and `/v2` clients). The wrapper↔CLI surface (`createSession`,
   `sendPrompt(Async)`, `sendCommand`, `subscribeEvents`, `abortSession`, permissions/questions,
   PTY) is what `kilo-v2` must keep stable or version.
3. **Blast radius splits cleanly:** admission changes touch six worker-side tRPC callers;
   streaming changes touch only SDK consumers (web/mobile/extension). Automation services never
   stream.

**Dispositions:** wrapper — no change now, version the contract + add contract tests in kilocode;
code-review-infra — no change (watch single-consumer `updateSession`); auto-triage/auto-fix/
webhook-ingest — no change (narrowest slice); security-auto-analysis — no change (uses
`interruptSession`); kilo-bot and web/mobile/extension — no change (control-plane/SDK-insulated);
`kilo cloud` CLI — already adapted; remaining work is the 5 deployed-verification gaps, which
require an authorized live environment per the epic's rule.

**Gaps to file (candidates for #14427/#14428):** deployed-verification pass; optional
`kilo cloud cancel` (product decision); contract tests for the wrapper-consumed server API;
flag single-consumer `updateSession` to cloud-agent-next owners.

**Verification limits:** static source at cited SHAs; no live endpoint contacted.
