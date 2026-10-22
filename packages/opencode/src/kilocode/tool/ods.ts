import { CFB } from "xlsx"

function attribute(xml: string, name: string) {
  return xml.match(new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(["'])(.*?)\\1`))?.[2]
}

export function visibility(bytes: Uint8Array) {
  const archive = CFB.read(bytes, { type: "buffer" })
  const content = CFB.find(archive, "content.xml")?.content
  if (!content) return new Set<number>()

  const xml = new TextDecoder().decode(content)
  const styles = new Set(
    Array.from(xml.matchAll(/<style:style(?=[\s>])([^>]*)>([\s\S]*?)<\/style:style\s*>/g)).flatMap((match) => {
      if (attribute(match[1], "family") !== "table") return []
      const hidden = /<style:table-properties(?=[\s>])[^>]*\btable:display\s*=\s*(["'])false\1/.test(match[2])
      const name = attribute(match[1], "name")
      return hidden && name ? [name] : []
    }),
  )
  return new Set(
    Array.from(xml.matchAll(/<table:table(?=[\s>])([^>]*)>/g)).flatMap((match, index) => {
      const style = attribute(match[1], "style-name")
      return style && styles.has(style) ? [index] : []
    }),
  )
}
