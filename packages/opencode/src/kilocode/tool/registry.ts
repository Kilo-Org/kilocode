// kilocode_change - new file
import { CodebaseSearchTool } from "../../tool/warpgrep"
import { RecallTool } from "../../tool/recall"
import { AgentManagerTool } from "./agent-manager"
import * as Tool from "../../tool/tool"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Agent } from "@/agent/agent"
import * as Truncate from "@/tool/truncate"

const log = Log.create({ service: "kilocode-tool-registry" })
type Deps = { agent: Agent.Interface; truncate: Truncate.Interface }

export namespace KiloToolRegistry {
  const hint =
    "- When you are doing an open-ended search where you do not know the exact symbol name, use the `semantic_search` tool first to narrow down the search scope, then follow up with `Grep` and/or `Read`"

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

  export function describe(tools: Tool.Def[], extra: { semantic?: Tool.Def }): Tool.Def[] {
    if (!extra.semantic) return tools
    return tools.map((tool) => {
      if (tool.id !== "glob" && tool.id !== "grep") return tool
      return { ...tool, description: `${tool.description}\n${hint}` }
    })
  }
}
