export * as KiloBrandingStructural from "./structural"

import { parseSync } from "@babel/core"

// Structural transforms are not branding text: they rewrite imports and logic
// so the upstream TUI uses Kilo's logo art, and swap the OAuth wordmark SVG.
// Unlike the rule engine they are exact, few, and fail loudly when upstream
// moves the code, so a human re-inspects the new implementation during a sync.
//
// Each transform is `[from, to, count]`: `apply` rewrites `from` to `to` and
// throws unless `from` appears exactly `count` times. The count makes an
// `apply` fail loud not only when upstream removes an anchor, but also when it
// adds a new occurrence a bare `replaceAll` would have rewritten silently.

const logic: Record<string, ReadonlyArray<readonly [string, string, number]>> = {
  "cli/src/services/update-preflight.tsx": [
    ['import { go } from "@opencode/tui/logo"', 'import { compact, palette } from "@opencode/tui/logo"', 1],
    ["const monogram = go.right.slice(1)", "const monogram = compact", 1],
    ["const monogramRamp = ramp(colors.muted, colors.accent)", "const monogramColor = RGBA.fromHex(palette.ink)", 1],
    [
      'const monogramInk = createMemo(() =>\n    props.outcome() === "success" ? shade(monogramRamp, smoothstep(headerFade.progress())) : colors.muted,\n  )',
      "const monogramInk = () => monogramColor",
      1,
    ],
    [
      '<box flexDirection="column">\n      <For each={monogram}>',
      '<box flexDirection="column" flexShrink={0} width={Math.max(...monogram.map((line) => Bun.stringWidth(line)))}>\n      <For each={monogram}>',
      1,
    ],
  ],
  "tui/src/component/logo.tsx": [
    ['import { go, logo } from "../logo"', 'import { compact, logo, widths, palette } from "../logo"', 1],
    ['import { useTheme } from "../context/theme"', 'import { useTheme, useThemes } from "../context/theme"', 1],
    [
      "const theme = useTheme()",
      'const theme = useTheme()\n  const themes = useThemes()\n  const ink = () => RGBA.fromHex(themes.mode() === "light" ? palette.dim : palette.ink)',
      1,
    ],
    [
      "const shadow = tint(theme.background.base, fg, 0.25)",
      'const shadow = tint(theme.background.base, fg, themes.mode() === "light" ? 0.75 : 0.25)',
      1,
    ],
    ["theme.text.muted, false", "ink(), false", 2],
    ["theme.text.base, true", "ink(), false", 3],
    ["dimensions().width < 22", "dimensions().width < widths.split + 2", 1],
    ["dimensions().width < 44", "dimensions().width < widths.full + 4", 1],
    ["go.right.slice(1)", "compact", 1],
    ["logo.left.slice(1)", "logo.left", 1],
  ],
  "tui/src/util/presentation.ts": [
    ['import { logo } from "../logo"', 'import { compact, logo, widths } from "../logo"', 1],
    [
      "  return logo.left.map((line, index) => {\n    const left",
      '  if ((process.stdout.columns ?? widths.full + pad.length) < widths.full + pad.length)\n    return compact.map((line) => `${pad}${draw(line, dim, "\\x1b[38;5;235m", "\\x1b[48;5;235m")}`)\n\n  return logo.left.map((line, index) => {\n    const left',
      1,
    ],
  ],
  // The built-in tool namespace is a product name the model and the user read
  // (`tools.kilo.session_move`). These are runtime IDs, not display text: the
  // rule engine leaves the bare `"opencode"` and dotted or underscored IDs alone,
  // so they are renamed here, and a new upstream tool fails the count.
  "core/src/tool/plugin/opencode.ts": [
    ['namespace: "opencode"', 'namespace: "kilo"', 6],
    ['name: "opencode"', 'name: "kilo"', 1],
    ["tools.opencode.session_move", "tools.kilo.session_move", 1],
  ],
  "core/src/tool/plugin/artifact.ts": [['namespace: "opencode"', 'namespace: "kilo"', 4]],
  "core/src/tool/plugin/schedule.ts": [['namespace: "opencode"', 'namespace: "kilo"', 5]],
  "core/src/tool/plugin/mcp-resource.ts": [
    ['namespace: "opencode"', 'namespace: "kilo"', 2],
    ["opencode_list_mcp_resources", "kilo_list_mcp_resources", 1],
    ["opencode_read_mcp_resource", "kilo_read_mcp_resource", 1],
  ],
  // Code Mode paths of the tools a schedule check may not call.
  "core/src/schedule/check.ts": [['"opencode.', '"kilo.', 8]],
  // The schedule command prompt names the namespace in prose, which the command rule would turn into `kilo2`.
  "core/src/plugin/command/schedule.txt": [["the `opencode` namespace", "the `kilo` namespace", 1]],
}

const OAUTH_PAGE = "core/src/oauth/page.ts"

// Every file the structural transforms touch. Must be a subset of the loader's
// intercepted `files` (text.ts), or a structural transform would never run; a
// test enforces that.
export const keys: ReadonlyArray<string> = [...Object.keys(logic), OAUTH_PAGE]

export function apply(key: string, source: string): string {
  const pairs = logic[key]
  const rewritten = pairs
    ? pairs.reduce((text, [from, to, count]) => {
        const found = text.split(from).length - 1
        if (found !== count)
          throw new Error(`Kilo branding no longer matches ${key}: expected ${count}x, found ${found}x: ${from}`)
        return text.replaceAll(from, to)
      }, source)
    : source
  if (key !== OAUTH_PAGE) return rewritten
  if (!/const WORDMARK = `<svg[\s\S]*?<\/svg>`/.test(rewritten))
    throw new Error("Kilo OAuth wordmark no longer matches the upstream page")
  return rewritten.replace(
    /const WORDMARK = `<svg[\s\S]*?<\/svg>`/,
    'const WORDMARK = `<svg class="wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" aria-label="Kilo Code" role="img"><path fill="currentColor" d="M0 0v100h100V0H0Zm92.592 92.592H7.407V7.407h85.185v85.185ZM61.111 71.91h9.259v7.407H58.73l-5.026-5.027V62.65h7.407v9.26Zm16.667 0H70.37v-9.26h-9.259v-7.407h11.64l5.027 5.026V71.91ZM46.296 61.111H38.89v-7.407h7.407v7.407ZM22.222 53.704h7.408V70.37h16.666v7.408H27.249l-5.027-5.027V53.704Zm55.556-14.815v7.407H53.704V38.89h8.278V29.63h-8.278v-7.408h10.659l5.026 5.027v11.64h8.389ZM29.63 30.556h9.259l7.407 7.407v8.333H38.89v-8.333H29.63v8.333h-7.408V22.222h7.408v8.334Zm16.666 0H38.89v-8.334h7.407v8.334Z" /></svg>`',
  )
}

// Replace the upstream `logo` wordmark export with a re-export of Kilo's art.
// The declaration is located in the AST and sliced out so the module's other
// exports (`go`) are preserved exactly.
export function brandLogoModule(source: string, artPath: string): string {
  const file = parseSync(source, {
    sourceType: "module",
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ["typescript"] },
  })
  const body = (file as { program?: { body: Array<Record<string, any>> } } | null)?.program?.body ?? []
  const declaration = body.find((node) => {
    if (node.type !== "ExportNamedDeclaration" || node.declaration?.type !== "VariableDeclaration") return false
    if (node.declaration.kind !== "const" || node.declaration.declarations.length !== 1) return false
    const variable = node.declaration.declarations[0]
    return (
      variable.id.type === "Identifier" && variable.id.name === "logo" && variable.init?.type === "ObjectExpression"
    )
  })
  if (typeof declaration?.start !== "number" || typeof declaration.end !== "number")
    throw new Error("Kilo logo no longer matches the upstream module")
  return (
    source.slice(0, declaration.start) +
    `export { logo, compact, widths, palette } from ${JSON.stringify(artPath)}\n` +
    source.slice(declaration.end)
  )
}
