export function fileName(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop() ?? path
}

export function dirName(path: string): string {
  const parts = path.replaceAll("\\", "/").split("/")
  if (parts.length <= 1) return ""
  const dir = parts.slice(0, -1).join("/")
  return dir.length > 30 ? `…/${parts.slice(-3, -1).join("/")}` : dir
}

export function buildHighlightSegments(val: string, paths: Set<string>): { text: string; highlight: boolean }[] {
  if (paths.size === 0) return [{ text: val, highlight: false }]

  const segments: { text: string; highlight: boolean }[] = []
  let remaining = val

  while (remaining.length > 0) {
    let earliest = -1
    let earliestPath = ""

    for (const path of paths) {
      const token = `@${path}`
      const idx = remaining.indexOf(token)
      if (idx !== -1 && (earliest === -1 || idx < earliest)) {
        earliest = idx
        earliestPath = path
      }
    }

    if (earliest === -1) {
      segments.push({ text: remaining, highlight: false })
      break
    }

    if (earliest > 0) {
      segments.push({ text: remaining.substring(0, earliest), highlight: false })
    }

    const token = `@${earliestPath}`
    segments.push({ text: token, highlight: true })
    remaining = remaining.substring(earliest + token.length)
  }

  return segments
}
