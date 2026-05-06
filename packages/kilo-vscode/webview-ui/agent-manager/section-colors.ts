/** Section color palette using VS Code theme CSS variables for theme-adaptive colors. */
export const SECTION_COLORS = [
  { label: "Red", css: "var(--vscode-terminal-ansiRed)" },
  { label: "Orange", css: "var(--vscode-charts-orange)" },
  { label: "Yellow", css: "var(--vscode-terminal-ansiYellow)" },
  { label: "Green", css: "var(--vscode-terminal-ansiGreen)" },
  { label: "Cyan", css: "var(--vscode-terminal-ansiCyan)" },
  { label: "Blue", css: "var(--vscode-charts-blue)" },
  { label: "Purple", css: "var(--vscode-charts-purple)" },
  { label: "Magenta", css: "var(--vscode-terminal-ansiMagenta)" },
] as const

/** Map a stored color label to its CSS variable string. Returns undefined for null/unknown labels. */
export function colorCss(label: string | null): string | undefined {
  if (!label) return undefined
  return SECTION_COLORS.find((c) => c.label === label)?.css
}

/** Pick a random color label for new sections. */
export function randomColor(): string {
  return SECTION_COLORS[Math.floor(Math.random() * SECTION_COLORS.length)]!.label
}
