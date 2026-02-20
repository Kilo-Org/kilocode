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
