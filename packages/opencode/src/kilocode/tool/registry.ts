// kilocode_change - new file
import { CodebaseSearchTool } from "../../tool/warpgrep"
import { RecallTool } from "../../tool/recall"
import { AgentManagerTool } from "./agent-manager"
import * as Tool from "../../tool/tool"
import { Flag } from "@/flag/flag"
import { Effect } from "effect"
import { Log } from "@/util"
import { Agent } from "@/agent/agent"
import * as Truncate from "@/tool/truncate"

const log = Log.create({ service: "kilocode-tool-registry" })
type Deps = { agent: Agent.Interface; truncate: Truncate.Interface }

export namespace KiloToolRegistry {
  /** Resolve Kilo-specific tool Infos outside any InstanceState, so their Truncate/Agent deps are
   * satisfied at the outer registry scope instead of leaking into InstanceState's Effect. */
  export function infos() {
    return Effect.gen(function* () {
      const codebase = yield* CodebaseSearchTool
      const recall = yield* RecallTool
      const manager = yield* AgentManagerTool
      return { codebase, recall, manager }
    })
  }

  /** Finalize Kilo-specific tools into Tool.Defs. Call this inside the InstanceState state Effect —
   * it has no Service deps beyond what Tool.init itself needs. */
  export function build(tools: { codebase: Tool.Info; recall: Tool.Info; manager: Tool.Info }, deps: Deps) {
    return Effect.gen(function* () {
      const base = yield* Effect.all({
        codebase: Tool.init(tools.codebase),
        recall: Tool.init(tools.recall),
        manager: Tool.init(tools.manager),
      })
      const semantic = yield* semanticTool(deps)
      return { ...base, semantic }
    })
  }

  function semanticTool(deps: Deps) {
    return Effect.gen(function* () {
      const ready = yield* Effect.tryPromise(() =>
        import("@/kilocode/indexing").then((mod) => mod.KiloIndexing.ready()),
      ).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("semantic search unavailable", { err })
            return false
          }),
        ),
      )
      if (!ready) return undefined

      const mod = yield* Effect.tryPromise(() => import("@/kilocode/tool/semantic-search")).pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            log.warn("semantic search tool unavailable", { err })
            return undefined
          }),
        ),
      )
      if (!mod) return undefined

      const info = yield* mod.SemanticSearchTool.pipe(
        Effect.provideService(Agent.Service, deps.agent),
        Effect.provideService(Truncate.Service, deps.truncate),
      )
      if (!info) return undefined
      return yield* Tool.init(info)
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
    tools: { codebase: Tool.Def; semantic?: Tool.Def; recall: Tool.Def; manager: Tool.Def },
    cfg: { experimental?: { codebase_search?: boolean; agent_manager_tool?: boolean } },
  ): Tool.Def[] {
    return [
      ...(cfg.experimental?.codebase_search === true ? [tools.codebase] : []),
      ...(tools.semantic ? [tools.semantic] : []),
      tools.recall,
      // The extension is the only client that can consume the Agent Manager start event.
      ...(Flag.KILO_CLIENT === "vscode" && cfg.experimental?.agent_manager_tool === true ? [tools.manager] : []),
    ]
  }

  /** Check for E2E LLM URL (uses KILO_E2E_LLM_URL env var) */
  export function e2e(): boolean {
    return !!process.env["KILO_E2E_LLM_URL"]
  }
}
