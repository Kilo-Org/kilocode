export * as KiloBranding from "./text"

import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { KiloBrandingRules } from "./rules"
import { KiloBrandingStructural } from "./structural"
import { KiloBrandingEngine } from "./engine"

const commands = ["opencode ", "kilo2 "] as const
const product = ['"OpenCode"', '"Kilo"'] as const
const title = ["`OC | ", "`Kilo | "] as const

// The expected OpenCode -> Kilo replacements per upstream file. The rule engine
// (rules.ts) and the structural transforms (structural.ts) produce these; this
// map is the oracle the branding tests assert against and the set of files the
// loader intercepts (plugin.ts). The engine also brands text no entry lists;
// the branding audit reports any user-visible OpenCode string it leaves behind.
export const replacements = {
  "cli/src/commands/commands.ts": [
    ["OpenCode command line interface", "Kilo command line interface"],
    ["Directory to start OpenCode in", "Directory to start Kilo in"],
    ["Upgrade OpenCode to the latest or a specific version", "Show manual Kilo update instructions"],
    [
      "Uninstall OpenCode, keeping session data, configuration, and state",
      "Uninstall Kilo, keeping session data, configuration, and state",
    ],
    ["Run OpenCode with a message", "Run Kilo with a message"],
  ],
  "cli/src/services/service-config.ts": [commands],
  "cli/src/server-process.ts": [commands],
  "cli/src/services/remote-tunnel.ts": [commands],
  "cli/src/mini.ts": [commands],
  "cli/src/mini-host.ts": [commands],
  "cli/src/acp/service.ts": [
    commands,
    ["Login with opencode", "Login with Kilo"],
    ["OpenCode Login", "Kilo Login"],
    product,
  ],
  "cli/src/acp/translate.ts": [["OpenCode prompt failed", "Kilo prompt failed"]],
  "cli/src/acp/error.ts": [["OpenCode server is unavailable", "Kilo server is unavailable"]],
  "cli/src/commands/handlers/acp.ts": [["opencode acp:", "kilo2 acp:"]],
  "cli/src/commands/handlers/mcp/auth.ts": [commands, ["opencode.json", KiloConfigFiles.newFile]],
  "cli/src/commands/handlers/stats.ts": [commands, ["opencode.ai", "kilo.ai"]],
  "cli/src/commands/handlers/pair.ts": [commands, ["your OpenCode server", "your Kilo server"]],
  "cli/src/commands/handlers/default.ts": [["OpenCode update could not start", "Kilo update could not start"]],
  "cli/src/commands/handlers/uninstall.ts": [
    ["Uninstall OpenCode", "Uninstall Kilo"],
    ["shared by OpenCode versions and channels", "shared by Kilo versions and channels"],
  ],
  "cli/src/services/update-preflight.tsx": [
    ["Loading OpenCode", "Loading Kilo"],
    product,
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
  "tui/src/util/error.ts": [commands, ["opencode.json", KiloConfigFiles.newFile]],
  "tui/src/util/error-details.ts": [
    ["this OpenCode component", "this Kilo component"],
    ["global OpenCode configuration", "global Kilo configuration"],
  ],
  "tui/src/util/presentation.ts": [
    commands,
    ["${bold}opencode${reset}", "${bold}kilo2${reset}"],
    ['import { logo } from "../logo"', 'import { compact, logo, widths } from "../logo"'],
    [
      "  return logo.left.map((line, index) => {\n    const left",
      '  if ((process.stdout.columns ?? widths.full + pad.length) < widths.full + pad.length)\n    return compact.map((line) => `${pad}${draw(line, dim, "\\x1b[38;5;235m", "\\x1b[48;5;235m")}`)\n\n  return logo.left.map((line, index) => {\n    const left',
    ],
  ],
  "tui/src/attention.ts": [product],
  "tui/src/app.tsx": [
    product,
    title,
    ["Update OpenCode", "Kilo update instructions"],
    ["https://opencode.ai/v2/docs", "https://kilo.ai/docs"],
  ],
  "tui/src/mini/runtime.lifecycle.ts": [product, title],
  "tui/src/routes/session/permission.tsx": [
    ["Tell OpenCode what to do differently", "Tell Kilo what to do differently"],
  ],
  "tui/src/mini/footer.permission.tsx": [["Tell OpenCode what to do differently", "Tell Kilo what to do differently"]],
  "tui/src/mini/footer.prompt.tsx": [["close OpenCode", "close Kilo"]],
  "tui/src/mini/splash.ts": [commands],
  "tui/src/component/dialog-update.tsx": [
    ["Updating OpenCode", "Updating Kilo"],
    [
      "Update successful! Restart closes OpenCode, then run opencode to use the new version.",
      "Update successful! Restart closes Kilo, then run kilo2 to use the new version.",
    ],
    ["restart OpenCode", "restart Kilo"],
    ["Installing OpenCode", "Installing Kilo"],
    ["OpenCode is already up to date", "Kilo is already up to date"],
  ],
  "tui/src/component/dialog-pair.tsx": [commands],
  "tui/src/component/terminal-pane.tsx": [["restart OpenCode", "restart Kilo"]],
  "tui/src/component/error-component.tsx": [
    ["OpenCode crashed", "Kilo crashed"],
    ["OpenCode {app.version}", "Kilo {app.version}"],
    ["OpenCode crash screen", "Kilo crash screen"],
    ["The OpenCode TUI crashed", "The Kilo TUI crashed"],
    ["https://github.com/anomalyco/opencode/issues/new", "https://github.com/Kilo-Org/kilocode/issues/new"],
  ],
  "tui/src/feature-plugins/system/stats.tsx": [
    ["opencode / stats", "kilo2 / stats"],
    ["opencode.ai", "kilo.ai"],
  ],
  "tui/src/feature-plugins/sidebar/footer.tsx": [["OpenCode includes free models", "Kilo includes free models"]],
  "tui/src/config/index.tsx": [["after OpenCode updates", "after Kilo updates"]],
  "core/src/oauth/page.ts": [
    ["OpenCode is now", "Kilo is now"],
    ["OpenCode couldn't", "Kilo couldn't"],
    ["try again from OpenCode", "try again from Kilo"],
    [" · OpenCode</title>", " · Kilo</title>"],
  ],
} satisfies Record<string, ReadonlyArray<readonly [string, string]>>

function key(file: string) {
  return file.replaceAll("\\", "/").split("/packages/").at(-1) ?? file
}

/**
 * Rebrand an upstream module. Only the files in `replacements` are intercepted
 * by the loader, so transform leaves every other file untouched. For an
 * intercepted file it applies, in order: the semantic overrides (whole-file),
 * the structural transforms (imports, logic, OAuth wordmark; fail loud on
 * drift), then the rule engine over user-visible text (dynamic; never throws).
 */
export function transform(file: string, source: string) {
  const id = key(file)
  if (!Object.hasOwn(replacements, id)) return source
  let out = source.replaceAll("\r\n", "\n")
  for (const override of KiloBrandingRules.overrides)
    if (id === override.file) out = out.replaceAll(override.from, override.to)
  out = KiloBrandingStructural.apply(id, out)
  return KiloBrandingEngine.brandText(file, out)
}
