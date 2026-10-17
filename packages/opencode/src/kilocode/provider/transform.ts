// Kilo-specific reasoning-effort gate for shared ProviderTransform.
//
// OpenAI rolled out the `none` and `xhigh` reasoning_effort tiers on fixed
// dates. Only gpt-5-family models accept them: non-OpenAI models routed
// through @ai-sdk/openai on a compatible base URL (e.g. Grok via api.x.ai)
// reject them, which surfaced as offering an unusable `xhigh` variant
// (issue #13342).

const GPT5_FAMILY_PREFIX_RE = /(?:^|\/|\.|-)gpt-5(?:[.-]|$)/

/**
 * True when the model id is a gpt-5 family member that may receive OpenAI's
 * rollout-gated reasoning tiers (`none`, `xhigh`).
 *
 * Matches bare ("gpt-5.5"), slash-prefixed ("openai/gpt-5.6"), dot-prefixed
 * ("openai.gpt-5.5", Bedrock Mantle), and hyphen-prefixed deployment ids
 * ("azure-openai--gpt-5.4", SAP AI Core) while still excluding lookalikes
 * such as "gpt-50" and "gpt-5o".
 */
export function gpt5FamilyReasoningTiers(id: string) {
  return GPT5_FAMILY_PREFIX_RE.test(id.toLowerCase())
}

type EndpointModel = {
  providerID: string
  api: { url?: string }
  options?: Record<string, unknown>
}

/**
 * True when providerID "openai" genuinely serves first-party OpenAI models.
 * A baseURL override to a third party (e.g. xAI) under that id serves
 * non-OpenAI models that reject the rollout-gated tiers (issue #13342), so the
 * exemption follows the effective endpoint, not the id alone. Model options
 * shadow provider options, matching resolveSDK/getModel precedence; with no
 * endpoint information the first-party default is preserved for forward
 * compatibility.
 */
export function isFirstPartyOpenAIEndpoint(model: EndpointModel, options: Record<string, unknown>): boolean {
  if (model.providerID !== "openai") return false
  const override =
    model.options?.["providerEndpointOverride"] ??
    model.options?.["endpoint"] ??
    model.options?.["baseURL"] ??
    options["providerEndpointOverride"] ??
    options["endpoint"] ??
    options["baseURL"]
  const endpoint = typeof override === "string" && override !== "" ? override : model.api.url
  if (typeof endpoint !== "string" || endpoint === "") return true
  let host: string
  try {
    host = new URL(endpoint).hostname.toLowerCase()
  } catch {
    // Unexpanded config placeholders ({env:...}, ${...}) cannot be judged.
    return true
  }
  return host === "openai.com" || host.endsWith(".openai.com")
}
