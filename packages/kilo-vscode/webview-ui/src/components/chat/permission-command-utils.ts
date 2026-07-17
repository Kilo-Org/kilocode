/**
 * Heredoc detection and parsing for permission command display.
 * Extracted from PermissionCommand to allow unit testing without SolidJS JSX.
 */

export type HeredocPart = {
  head: string
  body: string
  count: number
}

export function parseHeredoc(raw: string): HeredocPart | null {
  const lines = raw.split("\n")
  let start = -1
  let delim = ""
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/<<-?\s*(["']?)([\w-]+)\1\s*$/)
    if (m) {
      start = i
      delim = m[2]
      break
    }
  }
  if (start === -1) return null

  let end = -1
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i] === delim) {
      end = i
      break
    }
  }
  if (end === -1) return null

  const before = lines.slice(0, start + 1)
  const content = lines.slice(start + 1, end)
  const after = lines.slice(end)

  return {
    head: [...before, ...after].join("\n"),
    body: content.join("\n"),
    count: content.length,
  }
}
