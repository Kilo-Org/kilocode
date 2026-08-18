export namespace MemoryDecisions {
  export type Decision = {
    kind?: string
    result?: string
    reason?: string
    fallback?: boolean
    operationCount?: number
    skippedCount?: number
    query?: string
    topics?: string[]
    files?: string[]
    skipped?: { reason?: string; text?: string; duplicateOf?: string }[]
    operations?: {
      action?: string
      file?: string
      section?: string
      key?: string
      query?: string
    }[]
  }

  export type Operation = { type: "remove"; query?: string } | { type: "memory"; file: string; key: string }

  export type Skipped = {
    reason: string
    duplicateOf?: string
  }

  export type Save = {
    result: string
    reason?: string
  }

  export type Recall = {
    query?: string
    topics: string[]
    files: string[]
  }

  export type Summary = {
    lastSave?: Save
    latestOperations: Operation[]
    latestSkipped?: Skipped
    accepted: number
    skipped: number
    fallback: boolean
    files: string[]
    lastRecall?: Recall
    errors: string[]
  }

  export function parse(line: string) {
    try {
      const value = JSON.parse(line) as unknown
      if (!value || typeof value !== "object" || Array.isArray(value)) return
      return value as Decision
    } catch (_err) {
      return undefined
    }
  }

  function unique(input: string[]) {
    return [...new Set(input.filter(Boolean))]
  }

  function operations(input: Decision | undefined) {
    return (input?.operations ?? []).flatMap((item): Operation[] => {
      if (item.action === "remove") return [{ type: "remove", query: item.query }]
      if (!item.key) return []
      return [{ type: "memory", file: item.file ?? "memory", key: item.key }]
    })
  }

  function omitted(input: Decision | undefined) {
    const item = input?.skipped?.at(-1)
    if (!item) return
    return { reason: item.reason ?? "skipped", duplicateOf: item.duplicateOf }
  }

  export function summarize(text: string): Summary {
    const items = text
      .split("\n")
      .map((line) => parse(line))
      .filter((item): item is Decision => Boolean(item))
    const saves = items.filter((item) => item.kind === "typed")
    const recalls = items.filter((item) => item.kind === "recall")
    const save = saves.at(-1)
    const recall = recalls.at(-1)

    return {
      lastSave: save ? { result: save.result ?? "unknown", reason: save.reason } : undefined,
      latestOperations: operations(save),
      latestSkipped: omitted(save),
      accepted: saves.reduce((sum, item) => sum + (item.operationCount ?? 0), 0),
      skipped: saves.reduce((sum, item) => sum + (item.skippedCount ?? 0), 0),
      fallback: saves.some((item) => item.fallback || item.result === "fallback"),
      files: unique(saves.flatMap((item) => item.files ?? [])),
      lastRecall: recall
        ? {
            query: recall.query,
            topics: unique(recall.topics ?? []),
            files: recall.files ?? [],
          }
        : undefined,
      errors: unique(
        items
          .filter((item) => item.result === "error" || item.reason === "parse_error")
          .map((item) => item.reason ?? "error"),
      ),
    }
  }
}
