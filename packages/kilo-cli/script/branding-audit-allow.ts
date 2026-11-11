// Baseline allowlist for the branding audit (branding-audit.ts).
//
// Keyed by repo-relative path under `packages/`. Each entry suppresses the
// audit's findings for that whole file, with the reason the user-visible
// OpenCode text there is deliberately NOT Kilo-branded: a Kilo-replaced code
// path whose upstream strings are unreachable, an upstream SaaS product name,
// or a schema/provider identity. Reviewed at every upstream sync; the audit
// warns when an allowlisted file has no findings so a stale entry can be
// removed. A file-level entry means a NEW OpenCode string in that file is also
// suppressed — only allowlist files whose OpenCode is uniformly non-branding.
export const allow: ReadonlyMap<string, string> = new Map([
  [
    "cli/src/commands/handlers/upgrade.ts",
    "Upgrade command replaced by packages/kilo-cli/src/upgrade.ts; the upstream handler is unreachable in Kilo.",
  ],
  [
    "cli/src/services/updater.ts",
    "Updater service fully replaced by KiloUpdater.layer (packages/kilo-cli/src/updater.ts); the upstream method bodies and their strings are unreachable in Kilo.",
  ],
  ["cli/src/config/schema.ts", "The config JSON $schema URL is a schema identifier, not host branding."],
  [
    "tui/src/component/dialog-go-upsell.tsx",
    "OpenCode Go/Console are upstream SaaS product names, not host branding; whether this upsell appears in Kilo is a separate product decision.",
  ],
  ["tui/src/component/usage.tsx", "OpenCode Go/Console are upstream SaaS product names, not host branding."],
  ["tui/src/routes/session/index.tsx", "OpenCode Go is an upstream SaaS product name in an upsell, not host branding."],
  ["tui/src/util/usage-limits.ts", "OpenCode Console SaaS URLs, not host branding."],
  ["tui/src/mini/demo.ts", "Canned demo transcript content (an example config), not product UI branding."],
  [
    "core/src/plugin/skill/opencode.md",
    "Upstream OpenCode guide skill; KiloSkillConfigPlugin (packages/kilo-plugin/src/skill/config.ts) removes it and registers kilo-config instead, so its tools.opencode.* guidance never reaches the model in Kilo.",
  ],
  [
    "tui/src/util/tool-display.ts",
    "OpenCode is a provider/tool identity here; renaming it would break provider identity (see branding.test 'does not rename provider identities').",
  ],
])
