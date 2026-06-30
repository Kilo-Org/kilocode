// kilocode_change - new file
//
// Lenient, dependency-free model matching shared by agent_manager and
// agent_manager_models so the agent never needs an exact model name.
//
// A query matches when every alphanumeric token in the query appears in the
// alphanumeric-collapsed haystack (model name + qualified ids). This is
// order-independent and ignores punctuation/spacing, so "opus claude",
// "glm5.2", and "gpt5" all match "Claude Opus 4.1", "Z.ai: GLM 5.2", and
// "GPT-5.5" respectively. It is intentionally not typo-tolerant.

function collapse(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function matchesQuery(haystacks: string[], query: string): boolean {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return true
  // Join collapsed haystacks with a space so a token cannot match across the
  // boundary between two separate strings.
  const text = haystacks.map(collapse).join(" ")
  return tokens.every((token) => text.includes(token))
}
