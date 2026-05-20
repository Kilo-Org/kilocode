/**
 * frontmatter.ts — Parse YAML-ish frontmatter from text
 * Zero deps. Pure string ops.
 *
 * parse("---\\nname: test\\ntype: user\\n---\\nbody") → { name: "test", type: "user", body: "body" }
 */

export type Parsed = { meta: Record<string, string>; body: string }

const MAX = 30

export function parse(raw: string): Parsed {
  const lines = raw.split("\n").slice(0, MAX)
  let inFm = false
  let done = false
  const meta: Record<string, string> = {}
  let bodyStart = 0

  for (let i = 0; i < lines.length; i++) {
    if (done) { bodyStart = i; break }
    if (lines[i].trim() === "---") {
      if (inFm) { done = true; bodyStart = i + 1 }
      else inFm = true
      continue
    }
    if (inFm) {
      const m = lines[i].match(/^([A-Za-z_]\w*):\s*(.+)$/)
      if (m) meta[m[1]] = m[2]
    }
  }

  return { meta, body: done ? raw.split("\n").slice(bodyStart).join("\n") : raw }
}
