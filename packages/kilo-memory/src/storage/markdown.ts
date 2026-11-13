/** Serialization for memory source documents: `## Section` headings containing `- key :: text` items. */
export namespace MemoryMarkdown {
  export type Entry = { section: string; key: string; text: string }

  const defaultSection = "Facts"

  export function header(section: string) {
    return `## ${section}`
  }

  export function line(key: string, text: string) {
    return `- ${key} :: ${text}`
  }

  // Parse a source document into ordered entries. Items before the first heading take the default
  // section; non-item and malformed (empty key/body) lines are skipped.
  export function parse(text: string): Entry[] {
    const entries: Entry[] = []
    let section = defaultSection
    for (const raw of text.split("\n")) {
      const value = raw.trim()
      if (value.startsWith("## ")) {
        section = value.slice(3).trim() || section
        continue
      }
      if (!value.startsWith("- ") || !value.includes(" :: ")) continue
      const idx = value.indexOf(" :: ")
      const key = value.slice(2, idx).trim()
      const body = value.slice(idx + 4).trim()
      if (!key || !body) continue
      entries.push({ section, key, text: body })
    }
    return entries
  }

  // Upsert a line under its heading: replace an existing line with the same key in that section,
  // otherwise append; create the heading when absent. Reports whether the document changed.
  export function upsert(input: { text: string; section: string; line: string }) {
    const marker = header(input.section)
    const lines = input.text.split("\n")
    const at = lines.findIndex((item) => item.trim() === marker)
    if (at === -1) {
      const next = `${input.text.trimEnd()}\n\n${marker}\n${input.line}\n`
      return { text: next, changed: next !== input.text }
    }
    const end = lines.findIndex((item, idx) => idx > at && item.trim().startsWith("## "))
    const stop = end === -1 ? lines.length : end
    const prefix = input.line.split(" :: ")[0]
    const without = lines.filter((item, idx) => idx <= at || idx >= stop || !item.trim().startsWith(`${prefix} ::`))
    const head = without.slice(0, at + 1)
    const tail = without.slice(at + 1)
    const next = [...head, input.line, ...tail].join("\n")
    return { text: next, changed: next !== input.text }
  }

  // Remove every item line whose entry matches; headings and other lines are preserved.
  export function remove(input: { text: string; match: (entry: Entry) => boolean }) {
    const lines = input.text.split("\n")
    let section = defaultSection
    const kept = lines.filter((item) => {
      const value = item.trim()
      if (value.startsWith("## ")) {
        section = value.slice(3).trim() || section
        return true
      }
      if (!value.startsWith("- ") || !value.includes(" :: ")) return true
      const idx = value.indexOf(" :: ")
      const key = value.slice(2, idx).trim()
      const text = value.slice(idx + 4).trim()
      return !input.match({ section, key, text })
    })
    return { text: kept.join("\n"), count: lines.length - kept.length }
  }
}
