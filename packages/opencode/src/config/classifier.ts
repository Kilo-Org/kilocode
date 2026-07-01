import { Schema } from "effect"
import { ConfigModelID } from "./model-id"

// kilocode_change start — LLM command-approval classifier (issue #9138)

/**
 * `classifier` config block — sibling of `permission`. Gates what would
 * otherwise auto-approve; never overrides an explicit user `deny`/`ask`.
 * Modeled on Claude Code "auto mode" (reasoning-blind, fail-closed).
 *
 * The decision is produced by OpenGuardrails (OGR): the gated call becomes a
 * GuardEvent, run through the OGR Runtime composing a deterministic
 * `config_rules` detector with an LLM judge backed by the user's own model. There
 * is no backend enum — "local vs hosted" / "use my own model" is just which OGR
 * detectors are configured. To point the judge at a different model, set `model`;
 * to add deterministic regex rules or change how verdicts merge, set `rules` /
 * `composition` (the OGR policy).
 */
export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable the OGR command-approval classifier. Off by default.",
  }),
  model: Schema.optional(Schema.NullOr(ConfigModelID)).annotate({
    description: "Model backing the OGR LLM judge, e.g. 'anthropic/claude-haiku-4-5'. Defaults to the agent's own model.",
  }),
  environment: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Prose descriptions of trusted infrastructure. Anything outside is treated as exfiltration risk.",
  }),
  allow: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Exceptions to the block rules. Replacing this replaces the whole list (copy-default-then-edit).",
  }),
  soft_deny: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Block rules. Replacing this replaces the whole list (copy-default-then-edit).",
  }),
  rules: Schema.optional(Schema.Unknown).annotate({
    description: "OGR config_rules (deterministic regex layer): { command_rules, egress_allowlist, secret_env_markers }. Defaults to the bundled rules.",
  }),
  composition: Schema.optional(Schema.Unknown).annotate({
    description: "OGR composition: how detector verdicts merge per category (deny-wins / quorum). Defaults to deny-wins, fail-closed for security.*.",
  }),
}).annotate({ identifier: "ClassifierConfig" })
export type Info = Schema.Schema.Type<typeof Info>

// kilocode_change end

export * as ConfigClassifier from "./classifier"
