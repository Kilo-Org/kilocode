export type ReasoningHeading = {
  title?: string
  body: string
}

function clean(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function visible(value: string) {
  const closed = value.replace(/<!--[\s\S]*?-->/g, "")
  const start = closed.indexOf("<!--")
  if (start === -1) return closed.trim() ? value : ""
  const body = `${closed.slice(0, start)}${closed.slice(start + 4)}`
  return body.trim() ? body.trimStart() : ""
}

function pick(src: string, expr: RegExp, group = 1): ReasoningHeading | undefined {
  const found = src.match(expr)
  const raw = found?.[group]
  if (!found || !raw) return

  const title = clean(raw)
  if (!title) return

  const body = src.slice(found[0].length).trimStart()
  return {
    title,
    body: visible(body),
  }
}

export function reasoningHeading(text: string, partial = false): ReasoningHeading {
  const src = text.replace(/\r\n?/g, "\n").trim()
  if (partial && !src.includes("\n")) {
    const mark = src.startsWith("**") ? "**" : src.startsWith("__") ? "__" : ""
    if (mark && !src.endsWith(mark)) {
      return {
        title: clean(src.slice(mark.length)),
        body: "",
      }
    }
  }

  return (
    pick(src, /^<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>[ \t]*(?:\n|$)?/i) ??
    pick(src, /^#{1,6}[ \t]+([^\n]+?)(?:[ \t]+#+[ \t]*)?(?:\n|$)/) ??
    pick(src, /^([^\n]+)\n(?:=+|-+)[ \t]*(?:\n|$)/) ??
    pick(src, /^(\*\*|__)([^\n]+?)\1[ \t]*(?:\n|$)/, 2) ?? {
      body: visible(src),
    }
  )
}

export function reasoningSummary(body: string): string {
  const line = body
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.length > 0)
  if (!line) return ""

  const text = clean(line)
  if (!text) return ""

  const end = text.search(/[.!?](?:\s|$)/)
  if (end !== -1 && end + 1 <= 90) return text.slice(0, end + 1)
  if (text.length <= 90) return text

  const head = text.slice(0, 90).trimEnd()
  const cut = head.lastIndexOf(" ")
  return `${(cut > 0 ? head.slice(0, cut) : head).trimEnd()}…`
}
