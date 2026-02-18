/** @jsxImportSource solid-js */
import type { Preview, SolidRenderer } from "storybook-solidjs-vite"
import type { DecoratorFunction } from "storybook/internal/types"
import { applyKiloTheme, applyVscodeTheme, clearVscodeTheme } from "../src/stories/theme-decorator"
import "./fonts.css"
import "../src/styles/index.css"

const themeDecorator: DecoratorFunction<SolidRenderer> = (Story, context) => {
  const themeId = (context.globals["theme"] as string) ?? "kilo"
  const vscodeThemeId = (context.globals["vscodeTheme"] as string) ?? "dark-modern"

  const colorScheme = (() => {
    if (themeId === "kilo-vscode") return applyVscodeTheme(vscodeThemeId)
    clearVscodeTheme()
    return (context.globals["colorScheme"] as "light" | "dark") ?? "dark"
  })()

  applyKiloTheme(themeId, colorScheme)
  document.body.style.background = "var(--background-base)"
  document.body.style.color = "var(--text-base)"
  return Story()
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: "centered",
  },
  decorators: [themeDecorator],
  globalTypes: {
    theme: {
      description: "Theme",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: [
          { value: "kilo", title: "Kilo" },
          { value: "kilo-vscode", title: "Kilo VSCode" },
        ],
        dynamicTitle: true,
      },
    },
    colorScheme: {
      description: "Color Scheme",
      toolbar: {
        title: "Color Scheme",
        icon: "circlehollow",
        items: [
          { value: "dark", title: "Dark", icon: "moon" },
          { value: "light", title: "Light", icon: "sun" },
        ],
        dynamicTitle: true,
      },
    },
    vscodeTheme: {
      description: "VSCode Theme",
      toolbar: {
        title: "VSCode Theme",
        icon: "browser",
        items: [
          { value: "dark-modern", title: "Dark Modern (default)" },
          { value: "dark-plus", title: "Dark+" },
          { value: "dark-vs", title: "Dark (Visual Studio)" },
          { value: "light-modern", title: "Light Modern" },
          { value: "light-plus", title: "Light+" },
          { value: "light-vs", title: "Light (Visual Studio)" },
          { value: "hc-black", title: "High Contrast" },
          { value: "hc-light", title: "High Contrast Light" },
          { value: "monokai", title: "Monokai" },
          { value: "solarized-dark", title: "Solarized Dark" },
          { value: "solarized-light", title: "Solarized Light" },
          { value: "red", title: "Red" },
          { value: "quiet-light", title: "Quiet Light" },
          { value: "tomorrow-night-blue", title: "Tomorrow Night Blue" },
          { value: "kimbie-dark", title: "Kimbie Dark" },
          { value: "abyss", title: "Abyss" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: "kilo",
    colorScheme: "dark",
    vscodeTheme: "dark-modern",
  },
}

export default preview
