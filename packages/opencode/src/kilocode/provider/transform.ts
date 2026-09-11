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
