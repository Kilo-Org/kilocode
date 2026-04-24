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
  const symbols = raw
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .map((part) => {
      const mod = KEY_SYMBOLS[part]
      if (mod) return mac ? mod.mac : mod.other
      return SPECIAL_KEYS[part] ?? part.toUpperCase()
    })
  return mac ? symbols.join("") : symbols.join("+")
}

/** Agent Manager command prefix for keybinding extraction. */
const AM_PREFIX = "kilo-code.new.agentManager."

/** Global commands whose keybindings are forwarded to the webview. */
const GLOBAL_KEYBINDINGS: Record<string, string> = {
  "kilo-code.new.agentManagerOpen": "agentManagerOpen",
  "kilo-code.new.cycleAgentMode": "cycleAgentMode",
  "kilo-code.new.cyclePreviousAgentMode": "cyclePreviousAgentMode",
}

/**
 * Build a keybinding map from VS Code's raw `contributes.keybindings` array.
 * Returns a record of action name → formatted shortcut string.
 */
export function buildKeybindingMap(
  keybindings: Array<{ command: string; key?: string; mac?: string }>,
  mac: boolean,
): Record<string, string> {
  const bindings: Record<string, string> = {}

  for (const kb of keybindings) {
    const raw = mac ? (kb.mac ?? kb.key) : kb.key
    if (!raw) continue

    if (kb.command.startsWith(AM_PREFIX)) {
      bindings[kb.command.slice(AM_PREFIX.length)] = formatKeybinding(raw, mac)
      continue
    }
    const name = GLOBAL_KEYBINDINGS[kb.command]
    if (name) bindings[name] = formatKeybinding(raw, mac)
  }

  // Ensure fallback bindings are always present (may be missing from
  // cached packageJSON if the extension hasn't been fully reloaded)
  if (!bindings.runScript) bindings.runScript = formatKeybinding(mac ? "cmd+e" : "ctrl+e", mac)
  if (!bindings.toggleDiff) bindings.toggleDiff = formatKeybinding(mac ? "cmd+d" : "ctrl+d", mac)
  if (!bindings.showShortcuts) bindings.showShortcuts = formatKeybinding(mac ? "cmd+shift+/" : "ctrl+shift+/", mac)

  return bindings
}
