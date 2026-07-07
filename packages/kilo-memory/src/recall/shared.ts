import type { MemoryOperations } from "../capture/operations"
import { MemoryFiles } from "../storage/store"
import { MemoryMarkdown } from "../storage/markdown"
import { MemorySchema } from "../schema"
import { MemoryText } from "../text"
import { MemoryTopics } from "./topics"
import { MemoryRedact } from "../capture/redact"

export namespace MemoryShared {
  export type TypedItem = {
    file: MemorySchema.Source
    section: string
    key: string
    text: string
    topics: MemorySchema.Topic[]
    terms: string[]
    updatedAt?: number
  }

  export type SourceItem = {
    id: string
    file: MemorySchema.Source
    section: string
    key: string
    text: string
  }

  export const brief = MemoryText.brief

  export function entry(input: string) {
    const idx = input.indexOf(" :: ")
    if (idx < 0) return
    const key = input.slice(0, idx).trim()
    const text = input.slice(idx + 4).trim()
    if (!key || !text) return
    return { key, text }
  }

  export function terms(input: string, opts?: MemoryTopics.WordOptions) {
    return MemoryTopics.words(input, opts)
  }

  export function source(input: { file: MemorySchema.Source; text: string }): SourceItem[] {
    return MemoryMarkdown.parse(input.text).map((item) => ({
      id: `${input.file}:${item.section}:${item.key}`,
      file: input.file,
      section: item.section,
      key: item.key,
      text: `${item.key} ${item.text}`,
    }))
  }

  export function typed(input: {
    file: MemorySchema.Source
    text: string
    max: number
    inventory: MemoryFiles.Inventory
  }) {
    return MemoryMarkdown.parse(input.text).map((item) => {
      const id = MemoryFiles.inventoryKey({ file: input.file, section: item.section, key: item.key })
      const inv = input.inventory.items[id]
      const data = { file: input.file, section: item.section, key: item.key, text: item.text }
      return {
        file: input.file,
        section: item.section,
        key: item.key,
        text: brief(item.text, input.max),
        topics: inv?.topics?.length ? inv.topics : MemoryTopics.assign(data),
        terms: inv?.terms?.length ? inv.terms : MemoryTopics.terms(data),
        updatedAt: inv?.updatedAt,
      }
    })
  }

  export function refs(ops: MemoryOperations.Op[]) {
    return [
      ...new Set(
        ops.flatMap((item) => {
          if (item.action !== "add" || !item.file) return []
          return [`${item.file}:${item.key}`]
        }),
      ),
    ]
  }

  export function files(ops: MemoryOperations.Op[]) {
    return [
      ...new Set(
        ops.flatMap((item) => {
          if (item.action !== "add" || !item.file) return []
          return [item.file]
        }),
      ),
    ]
  }

  export function audit(ops: MemoryOperations.Op[]) {
    return ops.map((item) =>
      item.action === "add"
        ? {
            action: item.action,
            file: item.file,
            section: item.section,
            key: item.key,
          }
        : {
            action: item.action,
            query: brief(MemoryRedact.text(item.query), 120),
          },
    )
  }
}
