# Draft comment for #14425

> Publication note: replace `../../..` repo-relative reference to the technical note with a
> link to the merged file on `kilo-v2` at publication time (see README publication sequence).

---

Consumer inventory from static source, evidence for #14425. Full detail, per-row evidence, and
non-consumer confirmations are in `migration-tracking/technical-notes/cloud-agent-consumer-inventory.md`
(see PR link). Source: `Kilo-Org/cloud` @ `9a8c92ac7`, kilocode `kilo-v2` @ `1aec22c5b2`.

**Consumers identified (15):** cloud-agent-next runtime; in-container wrapper (installs
`@kilocode/cli@7.8.1`, consumes the CLI server API via `@kilocode/sdk` — the primary runtime
contract consumer); six automation services (code-review-infra, auto-triage-infra, auto-fix-infra,
security-auto-analysis, webhook-agent-ingest, kilo-bot); apps/web control plane + dashboard +
app-builder; apps/mobile; apps/extension; the `kilo cloud` CLI (already ported to v2); and
`@kilocode/cloud-agent-sdk` as the canonical interactive-client contract.

**Confirmed non-consumers:** gastown (name collision), security-sync, kilocode Agent Manager
(separate cloud-session import flow), kilo-sessions remote relay (#14019 surface).

**Open items before close:** owners per row (no CODEOWNERS in `Kilo-Org/cloud`), deployed versions
(source pins ≠ production), live enablement per service, and explicit scope ratification — the
inventory's scope column is a proposal, including whether security-auto-analysis's model-only
triage path is in scope.

**Migration-relevant finding:** the in-container runtime is already the v2-fork CLI (`kilo serve`
7.8.1 via the server API, not headless/ACP), so the migration requirement inverts — `kilo-v2`
must keep the wrapper-consumed server API surface stable or versioned. Contract map and
dispositions are on #14426.
