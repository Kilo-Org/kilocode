import { Schema } from "effect"
import { ConfigModelID } from "./model-id"

// kilocode_change start — LLM command-approval classifier (issue #9138)

/**
 * Which backend evaluates gated tool calls.
 * - `own`: the user's configured model (default; zero extra dependency).
 * - `og-local`: a locally-served OpenGuardrails model over HTTP (Ollama / GGUF).
 * - `og-saas`: the OpenGuardrails hosted API.
 */
export const Backend = Schema.Literals(["own", "og-local", "og-saas"]).annotate({
  identifier: "ClassifierBackend",
})
export type Backend = Schema.Schema.Type<typeof Backend>

/**
 * `classifier` config block — sibling of `permission`. Gates what would
 * otherwise auto-approve; never overrides an explicit user `deny`/`ask`.
 * Modeled on Claude Code "auto mode" (two-stage, reasoning-blind, fail-closed).
 */
export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable the LLM command-approval classifier. Off by default.",
  }),
  backend: Schema.optional(Backend).annotate({
    description: "Which classifier backend to use. Defaults to 'own' (the user's configured model).",
  }),
  model: Schema.optional(Schema.NullOr(ConfigModelID)).annotate({
    description: "Model for backend='own', e.g. 'anthropic/claude-haiku-4-5'. Defaults to the small/main model.",
  }),
  endpoint: Schema.optional(Schema.String).annotate({
    description: "HTTP endpoint for backend='og-local' (e.g. http://localhost:11434).",
  }),
  apiKey: Schema.optional(Schema.String).annotate({
    description: "API key for backend='og-saas'. Supports ${ENV_VAR} expansion.",
  }),
  twoStage: Schema.optional(Schema.Boolean).annotate({
    description: "Run a fast single-token pass, then a chain-of-thought pass only on blocks. backend='own' only.",
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
}).annotate({ identifier: "ClassifierConfig" })
export type Info = Schema.Schema.Type<typeof Info>

// kilocode_change end

export * as ConfigClassifier from "./classifier"
