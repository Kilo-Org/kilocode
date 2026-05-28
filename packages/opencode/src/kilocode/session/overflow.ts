import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"

export namespace KiloSessionOverflow {
  export function limit(input: { cfg: Config.Info; model: Provider.Model; usable: number }) {
    const percent = input.cfg.compaction?.threshold_percent
    if (typeof percent !== "number") return input.usable

    const context = input.model.limit.input || input.model.limit.context
    if (context === 0) return input.usable

    const cap = Math.floor(context * (percent / 100))
    return Math.min(input.usable, cap)
  }
}
