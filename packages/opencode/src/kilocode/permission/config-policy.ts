import { Effect } from "effect"
import type * as Config from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { ConfigProtection } from "./config-paths"

export namespace ConfigPolicy {
  export type Verdict = {
    /** Protection applies: the request must be asked and cannot persist an always rule. */
    protect: boolean
    /** Exact global skill subtree the request may persist, while global protection is active. */
    skill?: string
    /** Global config, loaded only when the request touches protected config or a global skill. */
    global?: Config.Info
  }

  /**
   * Resolve `require_approval_for_config_edits` for one request. Targets inside the project follow
   * the effective (project-merged) config; global config dirs and targets outside the project
   * follow the global config, so a project value never weakens protection outside the project.
   */
  export const check = Effect.fnUntraced(function* (config: Config.Interface, request: ConfigProtection.Target) {
    const scope = ConfigProtection.scope(request, yield* InstanceState.context)
    const skill = ConfigProtection.globalSkillPattern(request)
    if (!scope && !skill) return { protect: false } satisfies Verdict
    // Read the project config first: Config.get() only reloads the instance after a global edit if
    // it observes the change before getGlobal() refreshes the cached global stamp.
    const inside = scope?.inside === true && ConfigProtection.enabled(yield* config.get())
    const global = yield* config.getGlobal()
    const outside = ConfigProtection.enabled(global)
    return {
      protect: (scope?.outside === true && outside) || inside,
      skill: outside ? skill : undefined,
      global,
    } satisfies Verdict
  })
}
