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
    const found =
      input
        .toLowerCase()
        // NFKC folds compatibility variants, such as full-width letters, before lexical recall matching.
        .normalize("NFKC")
        .match(matcher)
        ?.map((item) => item.replaceAll(/[_.-]+/g, "_")) ?? []
    const result = [...new Set(found)]
    return max === undefined ? result : result.slice(0, max)
  }

  export function terms(input: Input, max = limit.terms) {
    return words([input.key ?? "", input.text].join(" "), max)
  }

  export function expand(input: string[], max = limit.expanded) {
    return [...new Set(input)].slice(0, max)
  }
}
