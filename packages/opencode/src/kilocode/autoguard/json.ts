/** JSON.parse plus duplicate-key rejection. No fences, reasoning or prose recovery. */
export function strictJSON(text: string): unknown {
  const value: unknown = JSON.parse(text)
  const objects: Set<string>[] = []
  let quoted = false
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === "\\") {
        i++
        continue
      }
      if (ch !== '"') continue
      quoted = false
      if (/^\s*:/.test(text.slice(i + 1))) {
        const key = JSON.parse(text.slice(start, i + 1)) as string
        const keys = objects.at(-1)
        if (keys?.has(key)) throw new Error("duplicate_json_key")
        keys?.add(key)
      }
      continue
    }
    if (ch === '"') {
      quoted = true
      start = i
    }
    if (ch === "{") objects.push(new Set())
    if (ch === "}") objects.pop()
  }
  return value
}
