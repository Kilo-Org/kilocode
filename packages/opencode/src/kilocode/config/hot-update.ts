import type { Config } from "@/config/config"
import { isRecord } from "@/util/record"

export namespace KilocodeConfigHotUpdate {
  export function hot(cfg: Config.Info) {
    const entries = Object.entries(cfg)
    if (entries.length === 0) return false
    return entries.every(([key, value]) => key === "console" || (key === "agent" && agents(value)))
  }

  function agents(value: unknown) {
    if (!isRecord(value)) return false
    return Object.values(value).every((item) => variant(item))
  }

  function variant(value: unknown) {
    if (!isRecord(value)) return false
    if (typeof value.variant !== "string" && value.variant !== null) return false
    return Object.entries(value).every(([key, item]) => {
      if (key === "variant") return true
      if (key !== "options" && key !== "permission") return false
      return isRecord(item) && Object.keys(item).length === 0
    })
  }
}
