// kilocode_change - new file
import { CodebaseSearchTool } from "../../tool/warpgrep"
import { RecallTool } from "../../tool/recall"
import { Tool } from "../../tool/tool"
import { Flag } from "@/flag/flag"
import { ProviderID } from "../../provider/schema"
import { Env } from "../../env"
import { Effect } from "effect"

export namespace KiloToolRegistry {
  /** Build Kilo-specific tools (CodebaseSearch, Recall) as Tool.Def */
  export function build(fn: (tool: Tool.Info) => Effect.Effect<Tool.Def, never, any>) {
    return Effect.gen(function* () {
      const codebase = yield* fn(CodebaseSearchTool)
      const recall = yield* fn(RecallTool)
      return { codebase, recall }
    })
  }

  /** Override question-tool client gating (adds "vscode" to allowed clients) */
  export function question(): boolean {
    return ["app", "cli", "desktop", "vscode"].includes(Flag.KILO_CLIENT) || Flag.KILO_ENABLE_QUESTION_TOOL
  }

  /** Plan tool is always registered in Kilo (gated by agent permission instead) */
  export function plan(tool: Tool.Info): Tool.Info[] {
    return [tool]
  }

  /** Kilo-specific tools to append to the builtin list */
  export function extra(
    tools: { codebase: Tool.Def; recall: Tool.Def },
    cfg: { experimental?: { codebase_search?: boolean } },
  ): Tool.Def[] {
    return [...(cfg.experimental?.codebase_search === true ? [tools.codebase] : []), tools.recall]
  }

  /** Check whether exa-based tools (codesearch/websearch) are enabled for a provider */
  export function exa(providerID: ProviderID): boolean {
    return providerID === ProviderID.kilo || Flag.KILO_ENABLE_EXA
  }

  /** Check for E2E LLM URL (uses KILO_E2E_LLM_URL env var) */
  export function e2e(): boolean {
    return !!Env.get("KILO_E2E_LLM_URL")
  }
}
