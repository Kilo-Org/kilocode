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

function pick(src: string, expr: RegExp, group = 1): ReasoningHeading | undefined {
  const found = src.match(expr)
  const raw = found?.[group]
  if (!found || !raw) return

  const title = clean(raw)
  if (!title) return

  return {
    title,
    body: src.slice(found[0].length).trimStart(),
  }
}

export function reasoningHeading(text: string): ReasoningHeading {
  const src = text.replace(/\r\n?/g, "\n").trim()
  return (
    pick(src, /^<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>[ \t]*(?:\n|$)?/i) ??
    pick(src, /^#{1,6}[ \t]+([^\n]+?)(?:[ \t]+#+[ \t]*)?(?:\n|$)/) ??
    pick(src, /^([^\n]+)\n(?:=+|-+)[ \t]*(?:\n|$)/) ??
    pick(src, /^(\*\*|__)([^\n]+?)\1[ \t]*(?:\n|$)/, 2) ?? {
      body: src,
    }
  )
}
