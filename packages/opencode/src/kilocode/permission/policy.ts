import { Effect } from "effect"
import type * as Config from "@/config/config"
import type { FSUtil } from "@opencode-ai/core/fs-util"
import type { Git } from "@/git"
import { InstanceState } from "@/effect/instance-state"
import { KilocodeProjectConfigStamp } from "@/kilocode/config/project-stamp"
import { ConfigProtection } from "./config-paths"

/**
 * Kilo-owned config-protection policy orchestration for the permission service.
 *
 * The shared permission module owns the request lifecycle; this module owns how the effective
 * global/project policies are loaded, how config cache freshness is observed, and how one immutable
 * target classification per request drives both the config-load gate and the verdict. Freshness
 * state is the caller's directory-scoped Permission state, so it never leaks across instances and
 * no config text or path result is cached beyond a single permission operation.
 */
export namespace KiloConfigPolicy {
  export type Policy = { global?: Config.Info; project?: Config.Info }

  /** One permission request or pending entry, classified against the active instance boundary. */
  export type Entry = {
    info: ConfigProtection.Target
  }

  export interface Deps {
    config: Config.Interface
    fs: FSUtil.Interface
    git: Git.Interface
  }

  /** Caller-owned, directory-scoped freshness state (the Permission instance state). */
  export interface State {
    projectStamp?: string
  }

  export function make(deps: Deps) {
    // Load the effective policies. A changed project digest invalidates only this instance's config
    // cache, which keeps the cached global object warm while Config.get/getGlobal still observe a
    // real global edit through the global stamp. An unknown digest (failed scan) always invalidates,
    // and the digest is recorded only after a successful invalidation, so a failed scan reloads
    // conservatively every time instead of pinning a stale config.
    const load = Effect.fnUntraced(function* (state: State) {
      const ctx = yield* InstanceState.context
      const digest = yield* KilocodeProjectConfigStamp.digest({
        fs: deps.fs,
        git: deps.git,
        directory: ctx.directory,
        worktree: ctx.worktree,
      })
      if (KilocodeProjectConfigStamp.stale(state.projectStamp, digest)) {
        yield* deps.config.invalidateInstance()
        state.projectStamp = digest
      }
      const project = yield* deps.config.get()
      const global = yield* deps.config.getEffectiveGlobal().pipe(Effect.catch(() => Effect.succeed({} as Config.Info)))
      return { global, project }
    })

    // Classify one request. The classification is immutable for the duration of one permission
    // operation, so the load gate and the policy verdict share the same filesystem resolution.
    const classify = (request: ConfigProtection.Target, root: string) => ConfigProtection.classify(request, root)

    // Apply the already-loaded policies to one classification without re-resolving any path. The
    // canonical skill scope is resolved here so every caller sees the same narrowing: protection uses
    // it while active, a file-tool read keeps it despite being ungated, and a disabled config edit
    // keeps its requested rule.
    const apply = (classification: ConfigProtection.Classification, policy?: Policy) => {
      const verdict = ConfigProtection.verdict(classification, policy ?? {})
      return { ...verdict, skill: ConfigProtection.skillScope(verdict) }
    }

    // Classify entries lazily and memoize per call. Callers pass the entry being decided first, so
    // the gate stops at the first config-shaped entry instead of resolving every pending sibling;
    // drain then reuses the memoized classifications and classifies only the siblings it reaches.
    // The map is scoped to this call only; the next ask/reply reclassifies because paths and
    // symlinks change.
    const plan = (root: string, entries: Iterable<Entry>) => {
      const all = [...new Set(entries)]
      const classes = new Map<Entry, ConfigProtection.Classification>()
      const inspect = (entry: Entry) => {
        const cached = classes.get(entry)
        if (cached) return cached
        const value = classify(entry.info, root)
        classes.set(entry, value)
        return value
      }
      const needs = () => {
        for (const entry of all) if (inspect(entry).candidate) return true
        return false
      }
      return {
        needs,
        verdict: (entry: Entry, policy?: Policy) => apply(inspect(entry), policy),
      }
    }

    return { load, classify, verdict: apply, plan }
  }
}
