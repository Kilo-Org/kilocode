// Pure keybinding helpers, ported from main's `agent-manager/format-keybinding.ts` and
// `agent-manager/user-keybindings.ts`. They keep no VS Code import so a unit test can call them.
import path from "node:path"

export type Binding = { command: string; key?: string; mac?: string; when?: string }

const KEY_SYMBOLS: Record<string, { mac: string; other: string }> = {
  ctrl: { mac: "⌃", other: "Ctrl" },
  cmd: { mac: "⌘", other: "Ctrl" },
  shift: { mac: "⇧", other: "Shift" },
  alt: { mac: "⌥", other: "Alt" },
}

const SPECIAL_KEYS: Record<string, string> = {
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  backspace: "⌫",
  delete: "Del",
  enter: "↵",
  escape: "Esc",
}

/** Format a VS Code keybinding string (e.g. "cmd+shift+w") with platform symbols: "⌘⇧W" or "Ctrl+Shift+W". */
export function formatKeybinding(raw: string, mac: boolean): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((chord) => {
      const symbols = chord
        .split("+")
        .map((p) => p.trim().toLowerCase())
        .map((part) => {
          const mod = KEY_SYMBOLS[part]
          if (mod) return mac ? mod.mac : mod.other
          return SPECIAL_KEYS[part] ?? part.toUpperCase()
        })
      return mac ? symbols.join("") : symbols.join("+")
    })
    .join(" ")
}

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

/** Apply the user's keybindings.json on top of the extension defaults, resolved for the platform. */
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

/** Candidate keybindings.json files for a global storage path. A profile without its own uses the default. */
export function userKeybindingFiles(storage: string): string[] {
  const dir = path.dirname(path.dirname(storage))
  const files = [path.join(dir, "keybindings.json")]
  if (path.basename(path.dirname(dir)) === "profiles") files.push(path.join(dir, "..", "..", "keybindings.json"))
  return files.map((file) => path.normalize(file))
}

/** Prompt actions whose keybindings are forwarded to the webview, keyed by command id. */
export const PROMPT_COMMANDS: Record<string, string> = {
  "kilo-code.v2.cycleAgentMode": "cycleAgentMode",
  "kilo-code.v2.cyclePreviousAgentMode": "cyclePreviousAgentMode",
}

/** Format the prompt-action keybindings, with the user's keybindings.json applied. */
export function resolvePromptKeybindings(
  defaults: Binding[],
  user: unknown,
  mac: boolean,
): Record<string, string> {
  const bindings: Record<string, string> = {}
  for (const binding of mergeUserKeybindings(defaults, user, mac)) {
    const name = PROMPT_COMMANDS[binding.command]
    if (name && binding.key) bindings[name] = formatKeybinding(binding.key, mac)
  }
  return bindings
}
