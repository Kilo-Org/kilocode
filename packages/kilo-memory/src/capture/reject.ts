import { MemoryText } from "../text"

/** Content gating for generated adds: drops self-referential, personal-preference, and instruction-provenance text. */
export namespace MemoryReject {
  export type Rejection = {
    reason: "self_referential" | "out_of_scope"
    text: string
  }

  // English best-effort backstop; the typed-consolidation prompt is the primary, language-agnostic defense.
  const self = [
    /\balready\b[^.]{0,120}\b(?:captured|covered|recorded|tracked|represented|saved|known)\b[^.]{0,120}\bmemor(?:y|ies)\b/i,
    /\balready\b[^.]{0,120}\bin\b[^.]{0,120}\bmemor(?:y|ies)\b/i,
    /\bmemor(?:y|ies)\b[^.]{0,120}\balready\b[^.]{0,120}\b(?:captures?|covers?|records?|tracks?|represents?|saves?|knows?|contains?)\b/i,
    // Whole single-clause meta statement ("X was investigated."). Anchored at the start with no
    // intervening sentence break so a real fact that merely ends a clause this way — "Refactored auth
    // in src/auth.ts. The retry path was reviewed." — is not rejected as a suffix match.
    /^[^.]*\b(?:was|were)\s+(?:investigated|checked|explored|reviewed)\b\.?$/i,
  ]
  const personal = [
    /^i\s+prefer\b/i,
    /^my\s+preferences?(?:\s+(?:is|are)\b|\b)/i,
    /^(?:the\s+)?user\s+prefers?\b/i,
    /^(?:the\s+)?users\s+preferences?(?:\s+(?:is|are)\b|\b)/i,
  ]
  const sourceMarkers = [
    /\bagents\.md\b/gi,
    /(?:^|[~\/\s])\.claude\/claude\.md\b/gi,
    /\bclaude\.md\b/gi,
    /\bsystem\s*\/\s*developer\b/gi,
  ]

  function provenance(input: string) {
    const count = sourceMarkers.reduce((sum, rule) => sum + (input.match(rule)?.length ?? 0), 0)
    // Only short-circuit when the value IS the source path (path-as-subject, e.g. describing what a
    // rules file contains). A fact that merely cites `.claude/claude.md` mid-sentence stays eligible.
    if (/^[~/]*\.claude\/claude\.md\b/i.test(input)) return true
    return count >= 3
  }

  export function reject(input: { text: string }): Rejection | undefined {
    const raw = input.text.trim()
    const value = MemoryText.normalized(raw)
    if (personal.some((rule) => rule.test(value))) return { reason: "out_of_scope", text: input.text }
    if (provenance(raw)) return { reason: "out_of_scope", text: input.text }
    if (!self.some((rule) => rule.test(value))) return
    return { reason: "self_referential", text: input.text }
  }
}
