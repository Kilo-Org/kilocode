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
  const corpus = {
    // A term must recur in at least `floor` entries to be dropped, so a topic word repeated in a
    // couple of entries of a small corpus stays matchable; below `floor` entries nothing qualifies.
    floor: 3,
    ratio: 0.4,
  }
  const matcher = /[\p{L}\p{N}][\p{L}\p{N}_.-]{1,}/gu

  export type WordOptions = { max?: number; drop?: ReadonlySet<string> }

  // Tokens that appear across much of the user's own corpus are non-discriminative in any language.
  export function ubiquitous(docs: string[][]) {
    const drop = new Set<string>()
    const counts = new Map<string, number>()
    for (const doc of docs) {
      for (const term of new Set(doc)) counts.set(term, (counts.get(term) ?? 0) + 1)
    }
    const needed = Math.max(corpus.floor, Math.ceil(docs.length * corpus.ratio))
    for (const [term, count] of counts) {
      if (count >= needed) drop.add(term)
    }
    return drop
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

  function options(input: number | WordOptions | undefined) {
    return typeof input === "number" ? { max: input } : (input ?? {})
  }

  export function words(input: string, opts?: number | WordOptions) {
    const cfg = options(opts)
    // NFKC folds compatibility variants, such as full-width letters, before lexical recall matching.
    const tokens = input.normalize("NFKC").match(matcher) ?? []
    const result: string[] = []
    const seen = new Set<string>()
    const push = (value: string) => {
      if (!value || cfg.drop?.has(value) || seen.has(value)) return
      seen.add(value)
      result.push(value)
    }
    for (const raw of tokens) {
      // Emit the whole compound (separators folded to _, trimmed) plus each camelCase/`_.-` part so
      // getUserName matches "user".
      push(raw.replaceAll(/[_.-]+/g, "_").replaceAll(/^_+|_+$/g, "").toLowerCase())
      for (const part of parts(raw)) push(part)
    }
    return cfg.max === undefined ? result : result.slice(0, cfg.max)
  }

  // Suffix-tolerant matching so inflected forms match across languages without language-specific stemming rules.
  export function related(a: string, b: string) {
    if (a === b) return true
    const shared = Math.min(a.length, b.length)
    return shared >= 4 && Math.abs(a.length - b.length) <= 3 && (a.startsWith(b) || b.startsWith(a))
  }

  export function terms(input: Input, max = limit.terms) {
    return words([input.key ?? "", input.text].join(" "), max)
  }

  export function expand(input: string[], max = limit.expanded) {
    return [...new Set(input)].slice(0, max)
  }
}
