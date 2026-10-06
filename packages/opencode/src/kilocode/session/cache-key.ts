// Per-session prompt-cache-key overrides. Kept as a leaf module (no imports) so
// provider transform code can consult it without pulling in session machinery.
const overrides = new Map<string, string>()

export function setPromptCacheKey(sessionID: string, key: string) {
  overrides.set(sessionID, key)
}

export function clearPromptCacheKey(sessionID: string) {
  overrides.delete(sessionID)
}

export function resolvePromptCacheKey(sessionID: string): string {
  return overrides.get(sessionID) ?? sessionID
}
