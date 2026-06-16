import { MemoryFs } from "./fs"
import { MemoryPaths } from "./paths"
import { MemorySchema } from "../schema"
import { MemoryTopics } from "../recall/topics"
import { MemorySlug } from "../slug"

export namespace MemorySources {
  export type InventoryItem = {
    file: MemorySchema.Source
    section: string
    key: string
    text: string
    topics?: MemorySchema.Topic[]
    terms?: string[]
    /** Derived from source file mtime and line offset; useful for ranking, not exact item creation time. */
    createdAt: number
    /** Derived from source file mtime and line offset; useful for ranking, not exact item update time. */
    updatedAt: number
  }

  export type Inventory = {
    version: 1
    items: Record<string, InventoryItem>
  }

  export function inventoryKey(input: { file: MemorySchema.Source; section: string; key: string }) {
    return [input.file, input.section, input.key]
      .map((item) => MemorySlug.safe(item, { max: MemorySlug.max.record, fallback: "" }))
      .join(":")
  }

  export async function readSource(root: string, name: MemorySchema.Source) {
    const file = MemoryPaths.source(root, name)
    return MemoryFs.read(file)
      .then((text) => text ?? "")
      .catch((error: unknown) => {
        if (MemoryFs.miss(error)) return ""
        throw error
      })
  }

  export async function writeSource(root: string, name: MemorySchema.Source, text: string) {
    await MemoryFs.write(MemoryPaths.source(root, name), text.endsWith("\n") ? text : `${text}\n`)
  }

  export async function deriveInventory(root: string): Promise<Inventory> {
    const items: Inventory["items"] = {}
    for (const file of MemorySchema.Sources) {
      const text = await readSource(root, file)
      const time = await MemoryFs.mtime(MemoryPaths.source(root, file)).catch((error: unknown) => {
        if (MemoryFs.miss(error)) return 0
        throw error
      })
      let section = "Facts"
      let offset = 0
      for (const raw of text.split("\n")) {
        const line = raw.trim()
        if (line.startsWith("## ")) {
          section = line.slice(3).trim() || section
          continue
        }
        if (!line.startsWith("- ") || !line.includes(" :: ")) continue
        const idx = line.indexOf(" :: ")
        const key = line.slice(2, idx).trim()
        const body = line.slice(idx + 4).trim()
        if (!key || !body) continue
        const data = { file, section, key, text: body }
        const stamp = Math.max(0, time - offset)
        items[inventoryKey(data)] = {
          ...data,
          topics: MemoryTopics.assign(data),
          terms: MemoryTopics.terms(data),
          createdAt: stamp,
          updatedAt: stamp,
        }
        offset++
      }
    }
    return { version: 1, items }
  }
}
