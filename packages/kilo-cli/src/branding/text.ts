export * as KiloBranding from "./text"

import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"

const commands = ["opencode ", "kilo2 "] as const
const product = ['"OpenCode"', '"Kilo"'] as const
const title = ["`OC | ", "`Kilo | "] as const

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
  "cli/src/services/update-preflight.tsx": [["Loading OpenCode", "Loading Kilo"], product],
  "tui/src/util/error.ts": [commands, ["opencode.json", KiloConfigFiles.newFile]],
  "tui/src/util/error-details.ts": [
    ["this OpenCode component", "this Kilo component"],
    ["global OpenCode configuration", "global Kilo configuration"],
  ],
  "tui/src/util/presentation.ts": [commands],
  "tui/src/attention.ts": [product],
  "tui/src/app.tsx": [
    product,
    title,
    ["Update OpenCode", "Kilo update instructions"],
    ["https://opencode.ai/docs", "https://kilo.ai/docs"],
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

export function transform(file: string, source: string) {
  const key = file.replaceAll("\\", "/").split("/packages/").at(-1) ?? file
  if (!Object.hasOwn(replacements, key)) return source
  const branded = replacements[key as keyof typeof replacements].reduce((text, [from, to]) => {
    if (!text.includes(from)) throw new Error(`Kilo branding no longer matches ${key}: ${from}`)
    return text.replaceAll(from, to)
  }, source)
  if (key !== "core/src/oauth/page.ts") return branded
  if (!/const WORDMARK = `<svg[\s\S]*?<\/svg>`/.test(branded))
    throw new Error("Kilo OAuth wordmark no longer matches the upstream page")
  return branded.replace(
    /const WORDMARK = `<svg[\s\S]*?<\/svg>`/,
    'const WORDMARK = `<svg class="wordmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" aria-label="Kilo Code" role="img"><path fill="currentColor" d="M0 0v100h100V0H0Zm92.592 92.592H7.407V7.407h85.185v85.185ZM61.111 71.91h9.259v7.407H58.73l-5.026-5.027V62.65h7.407v9.26Zm16.667 0H70.37v-9.26h-9.259v-7.407h11.64l5.027 5.026V71.91ZM46.296 61.111H38.89v-7.407h7.407v7.407ZM22.222 53.704h7.408V70.37h16.666v7.408H27.249l-5.027-5.027V53.704Zm55.556-14.815v7.407H53.704V38.89h8.278V29.63h-8.278v-7.408h10.659l5.026 5.027v11.64h8.389ZM29.63 30.556h9.259l7.407 7.407v8.333H38.89v-8.333H29.63v8.333h-7.408V22.222h7.408v8.334Zm16.666 0H38.89v-8.334h7.407v8.334Z" /></svg>`',
  )
}
