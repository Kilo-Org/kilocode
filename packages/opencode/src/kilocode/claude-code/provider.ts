// models.dev catalog overlay for the Claude Code provider. See
// packages/core/src/kilocode/claude-code/ for the actual LanguageModelV3 +
// MCP bridge that this catalog entry points at (via the "@kilocode/claude-code"
// npm key, resolved through KILO_BUNDLED_PROVIDERS in ../provider/provider.ts).
import type { Provider } from "@opencode-ai/core/models-dev"

export const PROVIDER_ID = "claude-code"

// Not a real npm package name — only a dispatch key. See KILO_BUNDLED_PROVIDERS
// in packages/opencode/src/kilocode/provider/provider.ts.
export const PACKAGE = "@kilocode/claude-code"

// Real (dated, non-aliased) model ids rather than `opus`/`sonnet`/`haiku`
// aliases, so this catalog matches how anthropic/* models are addressed and
// so ProviderTransform.variants() (packages/opencode/src/provider/transform.ts)
// can compute the exact same reasoning-effort tiers Anthropic's own catalog
// gets, using its existing model-id-version regexes.
//
// Every id below is confirmed to work directly as `--model <id>` (not just
// via `opus`/`sonnet`/`haiku` alias resolution), and every context/output
// limit is read from the `modelUsage` field of a live `claude --model <id> ...`
// probe — verified live 2026-07-30/31, not hand-guessed. Anthropic ships new
// models over time and can retire old ones, so this list can go stale the
// same way a models.dev snapshot can; re-verify with the same probe technique
// if an entry ever looks off or starts failing.
//
// `claude-fable-5` is a real, CLI-recognized model — it echoes back correctly
// in the `result` event — but on this account it fails with HTTP 429 "Usage
// credits are required for this model" (`overageDisabledReason:
// "org_level_disabled"`), i.e. it sits outside the standard subscription's
// included usage and needs separate paid credits. Its limits below are an
// unverified placeholder (matched to the Opus 5-tier default) since the
// account can never actually reach a real `modelUsage` value for it.
const MODELS = [
  { id: "claude-opus-4-1", name: "Claude Opus 4.1 (Claude Code)", context: 1_000_000, output: 64_000 },
  { id: "claude-opus-4-5", name: "Claude Opus 4.5 (Claude Code)", context: 200_000, output: 32_000 },
  { id: "claude-opus-4-6", name: "Claude Opus 4.6 (Claude Code)", context: 200_000, output: 64_000 },
  { id: "claude-opus-4-7", name: "Claude Opus 4.7 (Claude Code)", context: 1_000_000, output: 64_000 },
  { id: "claude-opus-4-8", name: "Claude Opus 4.8 (Claude Code)", context: 200_000, output: 32_000 },
  { id: "claude-opus-5", name: "Claude Opus 5 (Claude Code)", context: 200_000, output: 32_000 },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 (Claude Code)", context: 200_000, output: 32_000 },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Claude Code)", context: 200_000, output: 32_000 },
  { id: "claude-sonnet-5", name: "Claude Sonnet 5 (Claude Code)", context: 200_000, output: 32_000 },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (Claude Code)", context: 200_000, output: 32_000 },
  {
    id: "claude-fable-5",
    name: "Claude Fable 5 (Claude Code)",
    context: 200_000,
    output: 32_000,
  },
]

export const CatalogProvider: Provider = {
  id: PROVIDER_ID,
  name: "Claude Code",
  description: "Use a Claude Pro/Max/Team/Enterprise subscription through the Claude Code CLI, billed to your plan.",
  env: [],
  npm: PACKAGE,
  models: Object.fromEntries(
    MODELS.map((item) => [
      item.id,
      {
        id: item.id,
        name: item.name,
        release_date: "",
        // Image input is real, verified vision support, not a placeholder:
        // language-model.ts forwards `{type:"image",source:{type:"base64",...}}`
        // content blocks over the CLI's stream-json input, confirmed live by
        // sending a probe image and getting its actual color back correctly.
        // PDF/audio/video are NOT implemented (unlike the real anthropic/*
        // catalog, which sets pdf:true) — only image was built and verified.
        attachment: true,
        // The CLI streams `thinking` deltas that this provider maps to
        // reasoning stream parts.
        reasoning: true,
        // Sampling is controlled by the CLI, not the caller.
        temperature: false,
        tool_call: true,
        // Billed against the subscription, not per-token API spend — an empty
        // cost avoids Kilo reporting a charge the user never sees on an invoice.
        cost: { input: 0, output: 0 },
        limit: { context: item.context, output: item.output },
        modalities: { input: ["text", "image"], output: ["text"] },
      },
    ]),
  ),
}

export function overlay(providers: Record<string, Provider>): Record<string, Provider> {
  return { ...providers, [PROVIDER_ID]: CatalogProvider }
}
