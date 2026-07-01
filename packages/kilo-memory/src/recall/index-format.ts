import { MemoryFiles } from "../storage/store"
import { MemorySchema } from "../schema"
import { MemorySlug } from "../slug"
import type { MemoryShared } from "./shared"

/** Serializes inventory items and topic routing into the index's `record id=… / text: …` lines. */
export namespace MemoryIndexFormat {
  type Item = MemoryShared.TypedItem

  function type(section: string) {
    return MemorySchema.recordKind("project.md", section)
  }

  function rank(section: string) {
    const kind = type(section)
    if (kind === "PROJECT_DECISION") return 0
    if (kind === "PROJECT_CONSTRAINT") return 1
    if (kind === "PROJECT_FACT") return 2
    return 3
  }

  function id(input: string) {
    return MemorySlug.safe(input, { max: MemorySlug.max.record, fallback: "memory" })
  }

  function text(input: string) {
    return input.trim().replaceAll("```", "'''").replaceAll(/\s+/g, " ")
  }

  function date(input?: number | string) {
    if (typeof input === "string") return input.replaceAll(/\s+/g, "_")
    if (typeof input === "number" && Number.isFinite(input)) return new Date(input).toISOString()
    return "unknown"
  }

  export function record(input: { kind: string; id: string; source: string; updated?: number | string; text: string }) {
    return [
      `record id=${id(input.id)} type=${id(input.kind.toLowerCase())} source=${id(input.source)} updated=${date(input.updated)}`,
      `text: ${text(input.text)}`,
    ].join("\n")
  }

  export function lines(prefix: string, items: Item[]) {
    return items.map((item) =>
      record({
        kind: prefix,
        id: MemoryFiles.inventoryKey({ file: item.file, section: item.section, key: item.key }),
        source: item.file,
        updated: item.updatedAt,
        text: `${item.key} :: ${item.text}`,
      }),
    )
  }

  // One compact record mapping topics to the files holding them, so the model knows what kilo_memory_recall can find.
  export function hints(items: Item[]) {
    const rows = MemorySchema.Topics.flatMap((topic) => {
      const group = items.filter((item) => item.topics.includes(topic))
      if (group.length === 0) return []
      const files = [...new Set(group.map((item) => item.file))].sort().join(",")
      const latest = Math.max(...group.map((item) => item.updatedAt ?? 0))
      return [{ text: `topic=${topic} sources=${files} records=${group.length}`, latest }]
    })
    if (rows.length === 0) return []
    return [
      record({
        kind: "TOPIC_HINT",
        id: "topic.map",
        source: "inventory",
        updated: Math.max(...rows.map((row) => row.latest)) || "unknown",
        text: rows.map((row) => row.text).join(" | "),
      }),
    ]
  }

  export function project(items: Item[], input?: { include?: string[]; exclude?: string[] }) {
    const include = new Set(input?.include ?? [])
    const exclude = new Set(input?.exclude ?? [])
    return [...items]
      .filter((item) => {
        const kind = type(item.section)
        if (include.size > 0 && !include.has(kind)) return false
        return !exclude.has(kind)
      })
      .sort((a, b) => rank(a.section) - rank(b.section))
      .map((item) =>
        record({
          kind: type(item.section),
          id: MemoryFiles.inventoryKey({ file: item.file, section: item.section, key: item.key }),
          source: item.file,
          updated: item.updatedAt,
          text: `${item.key} :: ${item.text}`,
        }),
      )
  }
}
