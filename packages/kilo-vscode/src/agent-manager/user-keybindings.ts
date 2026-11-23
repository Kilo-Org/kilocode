import * as path from "node:path"

type Binding = { command: string; key?: string; mac?: string; when?: string }

/** Parse VS Code's keybindings.json, which allows comments and trailing commas. */
export function parseJsonc(text: string): unknown {
  const out: string[] = []
  const len = text.length
  let i = 0
  while (i < len) {
    const ch = text[i]!
    if (ch === '"') {
      const start = i
      i++
      while (i < len && text[i] !== '"') i += text[i] === "\\" ? 2 : 1
      out.push(text.slice(start, i + 1))
      i++
      continue
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < len && text[i] !== "\n") i++
      continue
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2)
      i = end === -1 ? len : end + 2
      continue
    }
    out.push(ch)
    i++
  }
  const json = out.join("").replace(/,(\s*[}\]])/g, "$1")
  // A half-written or invalid file must not break the labels: use the defaults.
  try {
    return JSON.parse(json) as unknown
  } catch {
    return undefined
  }
}

const norm = (key: string) =>
  key
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((part) =>
      part
        .split("+")
        .map((p) => p.trim())
        .join("+"),
    )
    .join(" ")

/**
 * Apply the user's keybindings.json on top of the extension defaults.
 * Entries are resolved for the current platform. Later entries win, like in VS Code.
 * A `-command` entry removes matching defaults and leaves a key-less entry,
 * so fallback labels do not bring a removed shortcut back.
 */
export function mergeUserKeybindings(defaults: Binding[], user: unknown, mac: boolean): Binding[] {
  const list: Binding[] = defaults.map((b) => ({
    command: b.command,
    key: mac ? (b.mac ?? b.key) : b.key,
    when: b.when,
  }))
  if (!Array.isArray(user)) return list
  for (const entry of user as Array<Record<string, unknown>>) {
    if (!entry || typeof entry.command !== "string") continue
    const key = typeof entry.key === "string" && entry.key.trim() ? norm(entry.key) : undefined
    const when = typeof entry.when === "string" ? entry.when : undefined
    if (entry.command.startsWith("-")) {
      const command = entry.command.slice(1)
      const keep = list.filter(
        (b) =>
          b.command !== command ||
          (key !== undefined && (b.key === undefined || norm(b.key) !== key)) ||
          (when !== undefined && b.when !== when),
      )
      list.splice(0, list.length, ...keep, { command })
      continue
    }
    if (key) list.push({ command: entry.command, key, when })
  }
  return list
}

/**
 * Candidate keybindings.json files for a global storage path
 * (`<User or profile>/globalStorage/<extension>`). A profile without its own
 * keybindings uses the default profile file.
 */
export function userKeybindingFiles(storage: string): string[] {
  const dir = path.dirname(path.dirname(storage))
  const files = [path.join(dir, "keybindings.json")]
  if (path.basename(path.dirname(dir)) === "profiles") files.push(path.join(dir, "..", "..", "keybindings.json"))
  return files.map((file) => path.normalize(file))
}
