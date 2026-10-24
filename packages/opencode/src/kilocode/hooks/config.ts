import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { ALL } from "./events"
import type { Hooks } from "./hooks"

// Config-loading helpers, kept apart from the runner so config/config.ts does not import the
// runner's dependencies (sessions, sandbox policy) and form an import cycle with them.

const log = Log.create({ service: "hooks" })

/**
 * Hooks run commands automatically with the user's permissions, so they are only honored from
 * trusted config (global, managed, organization). A project config could otherwise run commands
 * from a repository the user has not reviewed, or let a sandboxed agent escape by writing a hook.
 * A `.kilo`/`.kilocode` directory only counts as trusted when it is a global one: outside a git
 * repository, project directories above the working directory are otherwise classed as global.
 */
export function scope<T extends { hooks?: unknown }>(config: T, trusted: boolean, source: string): T {
  if (config.hooks === undefined) return config
  if (trusted && global(source)) return config
  log.warn("ignoring hooks from project config; define hooks in the global config", { source })
  const scoped = { ...config }
  delete scoped.hooks
  return scoped
}

function global(source: string) {
  const dir = path.dirname(source)
  if (![".kilo", ".kilocode"].includes(path.basename(dir))) return true
  const roots = [path.join(Global.Path.home, ".kilo"), path.join(Global.Path.home, ".kilocode"), Flag.KILO_CONFIG_DIR]
  return roots.some((root) => !!root && path.resolve(root) === path.resolve(dir))
}

/**
 * Hooks from every trusted config layer run; arrays are concatenated rather than replaced.
 * Identical groups are kept once, since a config file can be read by more than one loader.
 * Every registry event is kept: config merging replaces `hooks` with this result, so an event
 * missing here would vanish from the effective config.
 */
export function concat(a?: Hooks, b?: Hooks): Hooks | undefined {
  if (!a) return b
  if (!b) return a
  return Object.fromEntries(
    ALL.flatMap((event) => {
      const seen = new Set<string>()
      const groups = [...(a[event] ?? []), ...(b[event] ?? [])].filter((group) => {
        const key = JSON.stringify(group)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      return groups.length ? [[event, groups]] : []
    }),
  )
}

export * as KiloHookConfig from "./config"
