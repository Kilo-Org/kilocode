import type { ITheme } from "ghostty-web"

export interface RgbaColor {
  r: number
  g: number
  b: number
  a: number
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function toHex(r: number, g: number, b: number): string {
  const hex = (n: number) => clampByte(n).toString(16).padStart(2, "0")
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** Parse `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`, `rgb(...)`, and `rgba(...)` strings. */
export function parseCssColor(value: string): RgbaColor | undefined {
  const input = value.trim()
  if (input.startsWith("#")) return parseHexColor(input.slice(1))
  return parseRgbFunction(input)
}

function parseHexColor(hex: string): RgbaColor | undefined {
  if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined
  if (hex.length === 3 || hex.length === 4) {
    const r = Number.parseInt(hex[0]! + hex[0]!, 16)
    const g = Number.parseInt(hex[1]! + hex[1]!, 16)
    const b = Number.parseInt(hex[2]! + hex[2]!, 16)
    const a = hex.length === 4 ? Number.parseInt(hex[3]! + hex[3]!, 16) / 255 : 1
    return { r, g, b, a }
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = Number.parseInt(hex.slice(0, 2), 16)
    const g = Number.parseInt(hex.slice(2, 4), 16)
    const b = Number.parseInt(hex.slice(4, 6), 16)
    const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }
  return undefined
}

function parseRgbFunction(input: string): RgbaColor | undefined {
  const match =
    /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(input)
  if (!match) return undefined
  const alpha = match[4] === undefined ? 1 : match[5] === "%" ? Number(match[4]) / 100 : Number(match[4])
  if (Number.isNaN(alpha)) return undefined
  return {
    r: clampByte(Number(match[1])),
    g: clampByte(Number(match[2])),
    b: clampByte(Number(match[3])),
    a: Math.max(0, Math.min(1, alpha)),
  }
}

/** Composite a potentially translucent foreground over an opaque background. */
export function blendColor(fg: RgbaColor, bg: RgbaColor): RgbaColor {
  const a = fg.a
  return {
    r: clampByte(fg.r * a + bg.r * (1 - a)),
    g: clampByte(fg.g * a + bg.g * (1 - a)),
    b: clampByte(fg.b * a + bg.b * (1 - a)),
    a: 1,
  }
}

/**
 * Normalize a CSS color string to `#rrggbb` so libghostty's WASM color parser
 * (which accepts `#RGB`, `#RRGGBB`, and `rgb(...)`, not `#RRGGBBAA` or `rgba(...)`)
 * receives exact RGB values for the palette and OSC 10/11 color queries.
 */
export function normalizeHexColor(value: string, fallback: string, backdrop?: RgbaColor): string {
  const parsed = parseCssColor(value)
  if (!parsed) return fallback
  const resolved = parsed.a < 1 && backdrop ? blendColor(parsed, backdrop) : parsed
  return toHex(resolved.r, resolved.g, resolved.b)
}

function relativeLuminance(color: RgbaColor): number {
  const channel = (byte: number) => {
    const s = byte / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

function contrastRatio(first: RgbaColor, second: RgbaColor): number {
  const l1 = relativeLuminance(first)
  const l2 = relativeLuminance(second)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Pick a readable foreground for selected cells when the VS Code theme does not
 * define `--vscode-terminal-selectionForeground`. ghostty-web replaces cell text
 * color with `selectionForeground`, so falling back to its dark default `#1e1e1e`
 * would make dark-theme selections unreadable.
 */
export function pickSelectionForeground(selectionBg: string, foreground: string, background: string): string {
  const bg = parseCssColor(background) ?? { r: 30, g: 30, b: 30, a: 1 }
  const fg = parseCssColor(foreground) ?? { r: 212, g: 212, b: 212, a: 1 }
  const selRaw = parseCssColor(selectionBg)
  const sel = selRaw ? blendColor(selRaw, bg) : bg
  return contrastRatio(fg, sel) >= contrastRatio(bg, sel) ? toHex(fg.r, fg.g, fg.b) : toHex(bg.r, bg.g, bg.b)
}

function cssVar(style: CSSStyleDeclaration | undefined, name: string): string {
  return style?.getPropertyValue(name).trim() ?? ""
}

/** Detect the active VS Code color scheme from `document.body` theme classes. */
export function readColorScheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark"
  const classes = document.body?.classList
  if (classes?.contains("vscode-light") || classes?.contains("vscode-high-contrast-light")) return "light"
  return "dark"
}

/**
 * Build the libghostty theme object from VS Code's live `--vscode-terminal-*`
 * CSS custom properties.
 */
export function readTerminalTheme(): ITheme {
  const style = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : undefined
  const light = readColorScheme() === "light"
  const defaultBg = light ? "#ffffff" : "#1e1e1e"
  const defaultFg = light ? "#333333" : "#d4d4d4"
  const background = normalizeHexColor(
    cssVar(style, "--vscode-terminal-background") || cssVar(style, "--vscode-editor-background"),
    defaultBg,
  )
  const backdrop = parseCssColor(background)
  const color = (name: string, fallback: string) => normalizeHexColor(cssVar(style, name), fallback, backdrop)
  const foreground = color("--vscode-terminal-foreground", defaultFg)
  const selectionFallback = light ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.22)"
  const selectionRaw = cssVar(style, "--vscode-terminal-selectionBackground") || selectionFallback
  const selectionBackground = normalizeHexColor(selectionRaw, light ? "#add6ff" : "#264f78", backdrop)
  const explicitSelectionFg = cssVar(style, "--vscode-terminal-selectionForeground")
  const selectionForeground = explicitSelectionFg
    ? normalizeHexColor(explicitSelectionFg, foreground, backdrop)
    : pickSelectionForeground(selectionBackground, foreground, background)

  return {
    background,
    foreground,
    cursor: color("--vscode-terminalCursor-foreground", foreground),
    cursorAccent: color("--vscode-terminalCursor-background", background),
    selectionBackground,
    selectionForeground,
    black: color("--vscode-terminal-ansiBlack", "#000000"),
    red: color("--vscode-terminal-ansiRed", "#cd3131"),
    green: color("--vscode-terminal-ansiGreen", "#0dbc79"),
    yellow: color("--vscode-terminal-ansiYellow", "#e5e510"),
    blue: color("--vscode-terminal-ansiBlue", "#2472c8"),
    magenta: color("--vscode-terminal-ansiMagenta", "#bc3fbc"),
    cyan: color("--vscode-terminal-ansiCyan", "#11a8cd"),
    white: color("--vscode-terminal-ansiWhite", "#e5e5e5"),
    brightBlack: color("--vscode-terminal-ansiBrightBlack", "#666666"),
    brightRed: color("--vscode-terminal-ansiBrightRed", "#f14c4c"),
    brightGreen: color("--vscode-terminal-ansiBrightGreen", "#23d18b"),
    brightYellow: color("--vscode-terminal-ansiBrightYellow", "#f5f543"),
    brightBlue: color("--vscode-terminal-ansiBrightBlue", "#3b8eea"),
    brightMagenta: color("--vscode-terminal-ansiBrightMagenta", "#d670d6"),
    brightCyan: color("--vscode-terminal-ansiBrightCyan", "#29b8db"),
    brightWhite: color("--vscode-terminal-ansiBrightWhite", "#e5e5e5"),
  }
}
