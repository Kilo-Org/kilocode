// kilocode_change - new file
import type { WebSearchProvider } from "../../tool/websearch"

export namespace KiloWebSearch {
  /**
   * Default web search provider for built-in Kilo gateway sessions that do not
   * pin a provider via the `KILO_WEBSEARCH_PROVIDER` override or the
   * `KILO_ENABLE_EXA` / `KILO_ENABLE_PARALLEL` flags.
   *
   * Upstream opencode runs an even Exa/Parallel A/B split here; Kilo pins Exa.
   */
  export function defaultProvider(): WebSearchProvider {
    return "exa"
  }
}
