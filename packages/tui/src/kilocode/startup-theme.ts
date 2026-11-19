import { RGBA } from "@opentui/core"
import type { ResolvedTheme } from "@opencode/theme/tui"

// SGR 39/49 use the terminal's actual foreground and background, including when the terminal never answers OSC 11.
// Only the initial surfaces need provisional colors. The actual theme remains selected and continues to provide accents.
export function startupTheme(theme: ResolvedTheme): ResolvedTheme {
  const bg = RGBA.defaultBackground()
  const fg = RGBA.defaultForeground()
  return {
    ...theme,
    text: { ...theme.text, base: fg, muted: fg, faint: fg },
    background: { ...theme.background, base: bg, raised: { base: bg, high: bg, max: bg } },
    increase: (color, amount) => (color === bg ? bg : theme.increase(color, amount)),
    decrease: (color, amount) => (color === bg ? bg : theme.decrease(color, amount)),
    surface: (name) => startupTheme(theme.surface(name)),
  }
}
