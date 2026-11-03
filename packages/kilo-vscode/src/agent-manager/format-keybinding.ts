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

/**
 * Format a VS Code keybinding string (e.g. "cmd+shift+w") into
 * a display string using platform-appropriate symbols.
 * Mac: "⌘⇧W"  Windows/Linux: "Ctrl+Shift+W"
 */
export function formatKeybinding(raw: string, mac: boolean): string {
  // Chords such as "cmd+k cmd+m" are formatted part by part.
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

/** Agent Manager command prefix for keybinding extraction. */
const AM_PREFIX = "kilo-code.v2.agentManager."

/** Context key that reports focus inside the side terminal instead of the tab area. */
const SIDE_TERMINAL_FOCUSED = "kilo-code.v2.agentManager.sideTerminalFocused"

/** Global commands whose keybindings are forwarded to the webview. */
const GLOBAL_KEYBINDINGS: Record<string, string> = {
  "kilo-code.v2.cycleAgentMode": "cycleAgentMode",
  "kilo-code.v2.cyclePreviousAgentMode": "cyclePreviousAgentMode",
  "kilo-code.v2.settingsSearch": "settingsSearch",
}

/** [binding name, command suffix, key after the cmd/ctrl modifier] */
const FALLBACKS: Array<[string, string, string]> = [
  ["search", "search", "f"],
  ["runScript", "runScript", "e"],
  ["toggleDiff", "toggleDiff", "d"],
  ["showShortcuts", "showShortcuts", "shift+/"],
  ["previousTerminal", "previousTerminal", "shift+["],
  ["nextTerminal", "nextTerminal", "shift+]"],
  ["newTerminalCenter", "newTerminalTab", "shift+t"],
  ["newTerminalTerminal", "newSideTerminal", "t"],
]

function addBinding(bindings: Record<string, string>, name: string, value: string, when?: string): void {
  if (name === "newTerminalTab" && when?.includes(`!${SIDE_TERMINAL_FOCUSED}`)) {
    bindings.newTerminalCenter = value
    return
  }
  if (name === "newSideTerminal" && when?.includes(SIDE_TERMINAL_FOCUSED)) {
    bindings.newTerminalTerminal = value
    return
  }
  if (name === "newTerminalTab" || name === "newSideTerminal") return
  bindings[name] = value
}

function addRawBinding(
  bindings: Record<string, string>,
  kb: { command: string; key?: string; mac?: string; when?: string },
  mac: boolean,
): void {
  const raw = mac ? (kb.mac ?? kb.key) : kb.key
  if (!raw) return
  const value = formatKeybinding(raw, mac)
  const name = GLOBAL_KEYBINDINGS[kb.command]
  if (name) {
    bindings[name] = value
    return
  }
  // `agentManager.open` is the panel toggle, not an action inside the panel.
  if (kb.command === `${AM_PREFIX}open`) {
    bindings.agentManagerOpen = value
    return
  }
  if (kb.command.startsWith(AM_PREFIX)) {
    addBinding(bindings, kb.command.slice(AM_PREFIX.length), value, kb.when)
  }
}

/**
 * Build a keybinding map from VS Code's raw `contributes.keybindings` array.
 * Returns a record of action name → formatted shortcut string.
 */
export function buildKeybindingMap(
  keybindings: Array<{ command: string; key?: string; mac?: string; when?: string }>,
  mac: boolean,
): Record<string, string> {
  const bindings: Record<string, string> = {}

  for (const kb of keybindings) {
    addRawBinding(bindings, kb, mac)
  }

  // Ensure fallback bindings are present when the command is missing from a
  // cached packageJSON (extension not fully reloaded). A command the user
  // unbound has a key-less entry, so its fallback is not added.
  const removed = new Set(keybindings.filter((kb) => !kb.key && !kb.mac).map((kb) => kb.command))
  for (const [name, command, key] of FALLBACKS) {
    if (bindings[name] || removed.has(AM_PREFIX + command)) continue
    bindings[name] = formatKeybinding(mac ? `cmd+${key}` : `ctrl+${key}`, mac)
  }

  return bindings
}
