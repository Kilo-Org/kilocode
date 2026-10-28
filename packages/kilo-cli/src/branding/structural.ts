export * as KiloBrandingStructural from "./structural"

export const replacements = {
  "cli/src/commands/commands.ts": [
    [
      'typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : "opencode"',
      'typeof OPENCODE_CLI_NAME === "string" ? OPENCODE_CLI_NAME : "kilo2"',
    ],
  ],
  "cli/src/services/update-preflight.tsx": [
    ['import { go } from "@opencode/tui/logo"', 'import { compact, palette } from "@opencode/tui/logo"'],
    ["const monogram = go.right.slice(1)", "const monogram = compact"],
    ["const monogramRamp = ramp(colors.muted, colors.accent)", "const monogramColor = RGBA.fromHex(palette.ink)"],
    [
      'const monogramInk = createMemo(() =>\n    props.outcome() === "success" ? shade(monogramRamp, smoothstep(headerFade.progress())) : colors.muted,\n  )',
      "const monogramInk = () => monogramColor",
    ],
    [
      '<box flexDirection="column">\n      <For each={monogram}>',
      '<box flexDirection="column" flexShrink={0} width={Math.max(...monogram.map((line) => Bun.stringWidth(line)))}>\n      <For each={monogram}>',
    ],
  ],
  "tui/src/component/logo.tsx": [
    ['import { go, logo } from "../logo"', 'import { compact, logo, widths, palette } from "../logo"'],
    ['import { useTheme } from "../context/theme"', 'import { useTheme, useThemes } from "../context/theme"'],
    [
      "const theme = useTheme()",
      'const theme = useTheme()\n  const themes = useThemes()\n  const ink = () => RGBA.fromHex(themes.mode() === "light" ? palette.dim : palette.ink)',
    ],
    [
      "const shadow = tint(theme.background.base, fg, 0.25)",
      'const shadow = tint(theme.background.base, fg, themes.mode() === "light" ? 0.75 : 0.25)',
    ],
    ["theme.text.muted, false", "ink(), false"],
    ["theme.text.base, true", "ink(), false"],
    ["dimensions().width < 22", "dimensions().width < widths.split + 2"],
    ["dimensions().width < 44", "dimensions().width < widths.full + 4"],
    ["go.right.slice(1)", "compact"],
    ["logo.left.slice(1)", "logo.left"],
  ],
  "tui/src/util/presentation.ts": [
    ['import { logo } from "../logo"', 'import { compact, logo, widths } from "../logo"'],
    [
      "  return logo.left.map((line, index) => {\n    const left",
      '  if ((process.stdout.columns ?? widths.full + pad.length) < widths.full + pad.length)\n    return compact.map((line) => `${pad}${draw(line, dim, "\\x1b[38;5;235m", "\\x1b[48;5;235m")}`)\n\n  return logo.left.map((line, index) => {\n    const left',
    ],
  ],
} satisfies Record<string, ReadonlyArray<readonly [string, string]>>

export function wordmark(source: string) {
  if (!/const WORDMARK = `<svg[\s\S]*?<\/svg>`/.test(source))
    throw new Error("Kilo OAuth wordmark no longer matches the upstream page")
  return source.replace(
    /const WORDMARK = `<svg[\s\S]*?<\/svg>`/,
    'const WORDMARK = `<svg class="wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" aria-label="Kilo Code" role="img"><path fill="currentColor" d="M0 0v100h100V0H0Zm92.592 92.592H7.407V7.407h85.185v85.185ZM61.111 71.91h9.259v7.407H58.73l-5.026-5.027V62.65h7.407v9.26Zm16.667 0H70.37v-9.26h-9.259v-7.407h11.64l5.027 5.026V71.91ZM46.296 61.111H38.89v-7.407h7.407v7.407ZM22.222 53.704h7.408V70.37h16.666v7.408H27.249l-5.027-5.027V53.704Zm55.556-14.815v7.407H53.704V38.89h8.278V29.63h-8.278v-7.408h10.659l5.026 5.027v11.64h8.389ZM29.63 30.556h9.259l7.407 7.407v8.333H38.89v-8.333H29.63v8.333h-7.408V22.222h7.408v8.334Zm16.666 0H38.89v-8.334h7.407v8.334Z" /></svg>`',
  )
}
