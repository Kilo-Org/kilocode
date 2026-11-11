export * as KiloBranding from "./text"

import { KiloBrandingRules } from "./rules"
import { KiloBrandingStructural } from "./structural"
import { KiloBrandingEngine } from "./engine"

// The upstream modules the branding loader intercepts. Branding itself is not
// described here: the rule engine (rules.ts, engine.ts) brands user-visible
// text dynamically, and the structural transforms (structural.ts) rewrite the
// few logic sites and the OAuth wordmark. This list only decides which files
// are rebranded; the branding audit reports any user-visible OpenCode string
// the rules leave behind at a sync.
export const files: readonly string[] = [
  "cli/src/commands/commands.ts",
  "cli/src/services/service-config.ts",
  "cli/src/server-process.ts",
  "cli/src/services/remote-tunnel.ts",
  "cli/src/mini.ts",
  "cli/src/mini-host.ts",
  "cli/src/acp/service.ts",
  "cli/src/acp/translate.ts",
  "cli/src/acp/error.ts",
  "cli/src/commands/handlers/acp.ts",
  "cli/src/commands/handlers/mcp/auth.ts",
  "cli/src/commands/handlers/stats.ts",
  "cli/src/commands/handlers/pair.ts",
  "cli/src/commands/handlers/default.ts",
  "cli/src/commands/handlers/uninstall.ts",
  "cli/src/services/update-preflight.tsx",
  "tui/src/component/logo.tsx",
  "tui/src/util/error.ts",
  "tui/src/util/error-details.ts",
  "tui/src/util/presentation.ts",
  "tui/src/attention.ts",
  "tui/src/app.tsx",
  "tui/src/mini/runtime.lifecycle.ts",
  "tui/src/routes/session/permission.tsx",
  "tui/src/mini/footer.permission.tsx",
  "tui/src/mini/footer.prompt.tsx",
  "tui/src/mini/splash.ts",
  "tui/src/component/dialog-update.tsx",
  "tui/src/component/dialog-pair.tsx",
  "tui/src/component/terminal-pane.tsx",
  "tui/src/component/error-component.tsx",
  "tui/src/feature-plugins/system/stats.tsx",
  "tui/src/feature-plugins/sidebar/footer.tsx",
  "tui/src/config/index.tsx",
  "core/src/tool/plugin/opencode.ts",
  "core/src/tool/plugin/artifact.ts",
  "core/src/tool/plugin/schedule.ts",
  "core/src/tool/plugin/mcp-resource.ts",
  "core/src/schedule/check.ts",
  "core/src/oauth/page.ts",
]

const intercepted: ReadonlySet<string> = new Set(files)

function key(file: string) {
  return file.replaceAll("\\", "/").split("/packages/").at(-1) ?? file
}

/**
 * Rebrand an upstream module. Only the files in `files` are intercepted, so
 * transform leaves every other file untouched. For an intercepted file it
 * applies, in order: the semantic overrides (whole-file), the structural
 * transforms (imports, logic, OAuth wordmark; fail loud on drift), then the
 * rule engine over user-visible text (dynamic; never throws).
 */
export function transform(file: string, source: string) {
  const id = key(file)
  if (!intercepted.has(id)) return source
  let out = source.replaceAll("\r\n", "\n")
  for (const override of KiloBrandingRules.overrides)
    if (id === override.file) {
      if (!out.includes(override.from)) throw new Error(`Kilo branding no longer matches ${id}: ${override.from}`)
      out = out.replaceAll(override.from, override.to)
    }
  out = KiloBrandingStructural.apply(id, out)
  return KiloBrandingEngine.brandText(file, out)
}
