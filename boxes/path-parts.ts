export function filename(p: string | undefined): string {
  if (!p) return ""
  const parts = p.replace(/[/\\]+$/, "").split(/[/\\]/)
  return parts[parts.length - 1] ?? ""
}

export function dirname(p: string | undefined): string {
  if (!p) return ""
  const parts = p.replace(/[/\\]+$/, "").split(/[/\\]/)
  return parts.slice(0, parts.length - 1).join("/") + "/"
}

export function extname(p: string | undefined): string {
  if (!p) return ""
  const parts = p.split(".")
  return parts[parts.length - 1]
}

export function truncName(p: string | undefined, max = 20): string {
  const name = filename(p)
  if (name.length <= max) return name
  const dot = name.lastIndexOf(".")
  const e = dot <= 0 ? "" : name.slice(dot)
  const avail = max - e.length - 1
  if (avail <= 0) return name.slice(0, max - 1) + "…"
  return name.slice(0, avail) + "…" + e
}
