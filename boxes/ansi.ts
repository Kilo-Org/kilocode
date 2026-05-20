/**
 * ansi.ts — Terminal color: hex → ANSI escape sequence
 * Zero deps.
 *
 * bold("#ff6600") → "\x1b[38;2;255;102;0m\x1b[1m"
 */
export function valid(hex?: string): hex is string { return !!hex && /^#[0-9a-fA-F]{6}$/.test(hex) }

export function rgb(hex: string) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) }
}

export function bold(hex?: string): string | undefined {
  if (!valid(hex)) return undefined
  const { r, g, b } = rgb(hex)
  return `\x1b[38;2;${r};${g};${b}m\x1b[1m`
}
