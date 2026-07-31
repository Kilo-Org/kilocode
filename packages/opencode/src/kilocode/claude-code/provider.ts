// models.dev catalog overlay for the Claude Code provider. See
// packages/core/src/kilocode/claude-code/ for the actual LanguageModelV3 +
// MCP bridge that this catalog entry points at (via the "@kilocode/claude-code"
// npm key, resolved through KILO_BUNDLED_PROVIDERS in ../provider/provider.ts).
import type { Provider } from "@opencode-ai/core/models-dev"
import { MODELS } from "@opencode-ai/core/kilocode/claude-code/provider"

export const PROVIDER_ID = "claude-code"

// Not a real npm package name — only a dispatch key. See KILO_BUNDLED_PROVIDERS
// in packages/opencode/src/kilocode/provider/provider.ts.
export const PACKAGE = "@kilocode/claude-code"

// MODELS (ids, names, context/output limits) is the single source of truth
// shared with the v2 core catalog (packages/core/src/kilocode/claude-code/plugin.ts)
// — see the comment on MODELS in packages/core/src/kilocode/claude-code/provider.ts
// for why, and for verification details. Real (dated, non-aliased) model ids
// rather than `opus`/`sonnet`/`haiku` aliases, so this catalog matches how
// anthropic/* models are addressed and so ProviderTransform.variants()
// (packages/opencode/src/provider/transform.ts) can compute the exact same
// reasoning-effort tiers Anthropic's own catalog gets, using its existing
// model-id-version regexes.

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
