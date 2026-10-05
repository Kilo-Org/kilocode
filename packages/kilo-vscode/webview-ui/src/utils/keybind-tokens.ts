/** Parse a display keybinding string into separate key tokens for rendering.
 *  Windows/Linux format ("Ctrl+Shift+W") splits on "+".
 *  Mac format ("⌘⇧W") splits on known modifier symbols. */
export function parseBindingTokens(binding: string): string[] {
  if (!binding) return []
  // Chords such as "⌘K ⌘M" are parsed part by part.
  if (binding.includes(" ")) return binding.split(/\s+/).flatMap(parseBindingTokens)
  // Windows/Linux: "Ctrl+Shift+W" → ["Ctrl", "Shift", "W"]
  if (binding.includes("+")) return binding.split("+")
  // Mac: "⌘⇧W" → ["⌘", "⇧", "W"] — peel off known modifier symbols
  const tokens: string[] = []
  let rest = binding
  const modifiers = ["⌘", "⇧", "⌃", "⌥"]
  while (rest.length > 0) {
    const mod = modifiers.find((m) => rest.startsWith(m))
    if (mod) {
      tokens.push(mod)
      rest = rest.slice(mod.length)
    } else {
      tokens.push(rest)
      break
    }
  }
  return tokens
}

/** Split a binding into key groups. Chords ("⌘K ⌘A") and key pairs ("⌘[ ⌘]") give one group per part. */
export function parseBindingGroups(binding: string): string[][] {
  return binding.split(/\s+/).filter(Boolean).map(parseBindingTokens)
}
