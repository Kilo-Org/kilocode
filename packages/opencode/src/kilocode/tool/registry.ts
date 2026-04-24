// kilocode_change - new file
import { CodebaseSearchTool } from "../../tool/warpgrep"
import { RecallTool } from "../../tool/recall"
import { Tool } from "../../tool"
import { Flag } from "@/flag/flag"
import { ProviderID } from "../../provider/schema"
import { Effect } from "effect"

export namespace KiloToolRegistry {
  /** Resolve Kilo-specific tool Infos outside any InstanceState, so their Truncate/Agent deps are
   * satisfied at the outer registry scope instead of leaking into InstanceState's Effect. */
  export function infos() {
    return Effect.gen(function* () {
      const codebase = yield* CodebaseSearchTool
      const recall = yield* RecallTool
      return { codebase, recall }
    })
  }

  /** Finalize Kilo-specific tools into Tool.Defs. Call this inside the InstanceState state Effect —
   * it has no Service deps beyond what Tool.init itself needs. */
  export function build(tools: { codebase: Tool.Info; recall: Tool.Info }) {
    return Effect.all({
      codebase: Tool.init(tools.codebase),
      recall: Tool.init(tools.recall),
    })
  }

  /** Override question-tool client gating (adds "vscode" to allowed clients) */
  export function question(): boolean {
    return ["app", "cli", "desktop", "vscode"].includes(Flag.KILO_CLIENT) || Flag.KILO_ENABLE_QUESTION_TOOL
  }

  /** Plan tool is always registered in Kilo (gated by agent permission instead) */
  export function plan(): boolean {
    return true
  }

  /** Suggest tool is only registered for cli and vscode clients */
  export function suggest(tool: Tool.Def): Tool.Def[] {
    return ["cli", "vscode"].includes(Flag.KILO_CLIENT) ? [tool] : []
  }

  /** Kilo-specific tools to append to the builtin list */
  export function extra(
    tools: { codebase: Tool.Def; recall: Tool.Def },
    cfg: { experimental?: { codebase_search?: boolean } },
  ): Tool.Def[] {
    return [...(cfg.experimental?.codebase_search === true ? [tools.codebase] : []), tools.recall]
  }

  /** Check for E2E LLM URL (uses KILO_E2E_LLM_URL env var) */
  export function e2e(): boolean {
    return !!process.env["KILO_E2E_LLM_URL"]
  }
}
