import { MemorySchema } from "../schema"

export namespace MemoryTopics {
  export type Input = {
    file?: MemorySchema.Source
    section?: string
    key?: string
    text: string
  }

  const limit = {
    terms: 6,
    expanded: 24,
  }
  const matcher = /[\p{L}\p{N}][\p{L}\p{N}_.-]{1,}/gu

  // Recall tuning is English-first. The matcher above is Unicode-aware, so any language tokenizes and
  // matches; but the stopwords and stem() rules below are English. Non-English content simply falls back
  // to plain token-overlap (functional, lower precision) — nothing breaks. stem() is applied symmetrically
  // to query and stored terms, so same-language matches still line up even when a suffix is mis-stemmed.

  // ~30 English function words that carry no recall signal ("how do we run the tests" must score on run/tests only).
  const stopwords = new Set([
    "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "from", "by", "as",
    "is", "are", "was", "were", "be", "been", "it", "its", "this", "that", "these", "those",
    "i", "we", "you", "our", "us", "my", "me", "your", "how", "what", "when", "where", "why",
    "which", "who", "do", "does", "did", "the",
  ])

  // Light suffix stemming so "tests"~"test" and "ranking"~"rank"; only for tokens long enough to keep a real stem.
  function stem(token: string) {
    if (token.length < 5) return token
    if (token.endsWith("ing")) return token.slice(0, -3)
    if (token.endsWith("ed")) return token.slice(0, -2)
    if (token.endsWith("es")) return token.slice(0, -2)
    if (token.endsWith("s")) return token.slice(0, -1)
    return token
  }

  // Split a raw token on _ . - and camelCase, yielding its lowercase parts (getUserName -> get, user, name).
  function parts(token: string) {
    return token
      .split(/[_.\-]+/u)
      .flatMap((piece) =>
        piece
          .replaceAll(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2")
          .replaceAll(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
          .split(/\s+/u),
      )
      .map((piece) => piece.toLowerCase())
      .filter(Boolean)
  }

  function section(input: string | undefined) {
    return input?.trim().toLowerCase() ?? ""
  }

  export function assign(input: Input): MemorySchema.Topic[] {
    if (input.file === "corrections.md") return ["corrections"]
    if (input.file === "environment.md") return ["environment"]
    const name = section(input.section)
    if (name.includes("constraint")) return ["constraints"]
    if (name.includes("decision")) return ["project"]
    if (input.file === "project.md") return ["project"]
    return ["project"]
  }

  export function words(input: string, max?: number) {
    // NFKC folds compatibility variants, such as full-width letters, before lexical recall matching.
    const tokens = input.normalize("NFKC").match(matcher) ?? []
    const result: string[] = []
    const seen = new Set<string>()
    const push = (term: string) => {
      if (!term || stopwords.has(term)) return
      const value = stem(term)
      if (!value || seen.has(value)) return
      seen.add(value)
      result.push(value)
    }
    for (const raw of tokens) {
      // Emit the whole compound (separators folded to _, trimmed) plus each camelCase/`_.-` part so
      // getUserName matches "user" and "tests" matches "test".
      push(raw.replaceAll(/[_.-]+/g, "_").replaceAll(/^_+|_+$/g, "").toLowerCase())
      for (const part of parts(raw)) push(part)
    }
    return max === undefined ? result : result.slice(0, max)
  }

  export function terms(input: Input, max = limit.terms) {
    return words([input.key ?? "", input.text].join(" "), max)
  }

  export function expand(input: string[], max = limit.expanded) {
    return [...new Set(input)].slice(0, max)
  }
}
