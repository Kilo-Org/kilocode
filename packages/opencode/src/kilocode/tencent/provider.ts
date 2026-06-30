// kilocode_change - new file
//
// Catalog overlay for Tencent's OpenAI-compatible endpoints:
//   - Tencent TokenHub  (https://tokenhub.tencentmaas.com/v1)   [existing in models.dev]
//   - Tencent TokenPlan (https://api.lkeap.cloud.tencent.com/plan/v3) [added here]
//
// Requirement 1: add the `hy3` model to the existing Tencent TokenHub provider
//   without removing the catalog's `hy3-preview`. `hy3` is derived from
//   `hy3-preview` so its capabilities and thinking depth stay aligned.
// Requirement 2: add a Tencent TokenPlan provider that only exposes `hy3`,
//   reusing the same model config (and the TokenHub icon, see provider-icons).

import type { Model, Provider } from "@opencode-ai/core/models-dev"

export const TOKENHUB_PROVIDER_ID = "tencent-tokenhub"
export const TOKENPLAN_PROVIDER_ID = "tencent-tokenplan"

const HY3_MODEL_ID = "hy3"
const HY3_PREVIEW_MODEL_ID = "hy3-preview"

// 256K context window, 64000 max output tokens (matches hy3-preview).
const CONTEXT_WINDOW = 256_000
const MAX_OUTPUT_TOKENS = 64_000

// Fallback used only when the live catalog doesn't expose hy3-preview (e.g. when
// model fetching is disabled or offline). Mirrors the hy3-preview definition so
// the thinking depth (reasoning effort variants) stays identical.
function hy3Fallback(): Model {
  return {
    id: HY3_MODEL_ID,
    name: "Hy3",
    family: "Hy",
    release_date: "",
    attachment: false,
    reasoning: true,
    temperature: true,
    tool_call: true,
    cost: { input: 0, output: 0 },
    limit: { context: CONTEXT_WINDOW, output: MAX_OUTPUT_TOKENS },
    modalities: { input: ["text"], output: ["text"] },
  }
}

// Clone hy3-preview into a new `hy3` model so capabilities, limits, cost and
// (most importantly) the thinking depth all stay aligned with hy3-preview.
function deriveHy3(preview: Model | undefined): Model {
  if (!preview) return hy3Fallback()
  return { ...preview, id: HY3_MODEL_ID, name: "Hy3" }
}

// Fallback TokenHub provider definition, only used if the catalog is missing it.
const TokenHubProviderFallback: Provider = {
  id: TOKENHUB_PROVIDER_ID,
  name: "Tencent TokenHub",
  env: ["TENCENT_TOKENHUB_API_KEY"],
  api: "https://tokenhub.tencentmaas.com/v1",
  npm: "@ai-sdk/openai-compatible",
  models: {},
}

export function overlay(providers: Record<string, Provider>): Record<string, Provider> {
  const tokenHub = providers[TOKENHUB_PROVIDER_ID] ?? TokenHubProviderFallback
  const hy3 = deriveHy3(tokenHub.models[HY3_PREVIEW_MODEL_ID])

  return {
    ...providers,
    // Requirement 1: keep the existing models (incl. hy3-preview) and add hy3.
    [TOKENHUB_PROVIDER_ID]: {
      ...tokenHub,
      models: { ...tokenHub.models, [HY3_MODEL_ID]: hy3 },
    },
    // Requirement 2: TokenPlan exposes only hy3, with the same model config.
    [TOKENPLAN_PROVIDER_ID]: {
      id: TOKENPLAN_PROVIDER_ID,
      name: "Tencent Token Plan",
      env: ["TENCENT_TOKENPLAN_API_KEY"],
      api: "https://api.lkeap.cloud.tencent.com/plan/v3",
      npm: "@ai-sdk/openai-compatible",
      models: { [HY3_MODEL_ID]: hy3 },
    },
  }
}
