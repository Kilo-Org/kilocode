import { createEffect, type JSX } from "solid-js"
import { DEFAULT_THEMES } from "../theme/default-themes"
import { resolveThemeVariant, themeToCss } from "@opencode-ai/ui/theme/resolve"
import { VSCODE_THEMES } from "./vscode-themes"

const STYLE_ID = "storybook-kilo-theme"
const VSCODE_STYLE_ID = "storybook-vscode-theme"

function getOrCreateStyle(id: string): HTMLStyleElement {
  const existing = document.getElementById(id) as HTMLStyleElement | null
  if (existing) return existing
  const el = document.createElement("style")
  el.id = id
  document.head.appendChild(el)
  return el
}

export function applyKiloTheme(themeId: string, colorScheme: "light" | "dark") {
  const theme = DEFAULT_THEMES[themeId]
  if (!theme) return

  const isDark = colorScheme === "dark"
  const variant = isDark ? theme.dark : theme.light
  const tokens = resolveThemeVariant(variant, isDark)
  const css = themeToCss(tokens)

  const fullCss = `:root {
  color-scheme: ${colorScheme};
  --text-mix-blend-mode: ${isDark ? "plus-lighter" : "multiply"};
  ${css}
}`
  getOrCreateStyle(STYLE_ID).textContent = fullCss
  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = colorScheme
}

export function applyVscodeTheme(vscodeThemeId: string): "light" | "dark" {
  const theme = VSCODE_THEMES[vscodeThemeId]
  if (!theme) return "dark"
  const vars = Object.entries(theme.vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")
  getOrCreateStyle(VSCODE_STYLE_ID).textContent = `:root {\n${vars}\n}`
  return theme.colorScheme
}

export function clearVscodeTheme() {
  const el = document.getElementById(VSCODE_STYLE_ID)
  if (el) el.textContent = ""
}

export interface ThemeDecoratorProps {
  Story: () => JSX.Element
  theme: string
  colorScheme: "light" | "dark"
}

export function ThemeDecorator(props: ThemeDecoratorProps): JSX.Element {
  createEffect(() => {
    applyKiloTheme(props.theme, props.colorScheme)
  })
  return <props.Story />
}
