import { ScopedCache } from "effect"
import type { Config } from "@/config/config"
import type * as InstanceState from "@/effect/instance-state"
import { isRecord } from "@/util/record"

const sandbox = new Set(["sandbox", "sandbox_restrict_network"])

export namespace KilocodeConfigHotUpdate {
  export function matches(patch: Config.Info) {
    return Object.entries(patch).every(([key, value]) => {
      if (key === "console") return true
      if (key !== "experimental" || !isRecord(value)) return false
      return Object.keys(value).every((name) => sandbox.has(name))
    })
  }

  export function invalidate<A, E, R>(state: InstanceState.InstanceState<A, E, R>) {
    return ScopedCache.invalidateAll(state.cache)
  }
}
