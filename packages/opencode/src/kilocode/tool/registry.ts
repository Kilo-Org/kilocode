// kilocode_change - new file
import { CodebaseSearchTool } from "../../tool/warpgrep"
import { RecallTool } from "../../tool/recall"
import { AgentManagerTool } from "./agent-manager"
import { BackgroundProcessTool } from "./background-process"
import { FindReferencesTool } from "./find-references" // kilocode_change
import { CallHierarchyTool } from "./call-hierarchy" // kilocode_change
import { DependencyGraphTool } from "./dependency-graph" // kilocode_change
import { ImpactAnalysisTool } from "./impact-analysis" // kilocode_change
import { TraceTool } from "./trace" // kilocode_change
import { SymbolContextTool } from "./symbol-context" // kilocode_change
import { GraphQueryTool } from "./graph-query" // kilocode_change
import * as Tool from "../../tool/tool"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { Agent } from "@/agent/agent"
import * as Truncate from "@/tool/truncate"
import type { Config } from "@/config/config"

const log = Log.create({ service: "kilocode-tool-registry" })
type Deps = { agent: Agent.Interface; truncate: Truncate.Interface; indexing?: boolean }
type Loaders = {
  indexing?: () => Promise<{ KiloIndexing: { ready: () => boolean } }>
  semantic?: () => Promise<Pick<typeof import("@/kilocode/tool/semantic-search"), "SemanticSearchTool">>
}

export namespace KiloToolRegistry {
  const hint =
    "- When you are doing an open-ended search where you do not know the exact symbol name, use the `semantic_search` tool first to narrow down the search scope, then follow up with `Grep` and/or `Read`. For understanding symbol relationships, use `find_references`, `call_hierarchy`, or `dependency_graph`."

  export function indexing(
    config: Pick<Config.Info, "indexing">,
    global?: Pick<Config.Info, "indexing">,
  ): boolean | undefined {
    return config.indexing?.enabled ?? global?.indexing?.enabled
  }

  /** Resolve Kilo-specific tool Infos outside any InstanceState, so their Truncate/Agent deps are
   * satisfied at the outer registry scope instead of leaking into InstanceState's Effect. */
  export function infos() {
    return Effect.gen(function* () {
      const codebase = yield* CodebaseSearchTool
      const recall = yield* RecallTool
      const manager = yield* AgentManagerTool
      const process = yield* BackgroundProcessTool
      const findReferences = yield* FindReferencesTool // kilocode_change
      const callHierarchy = yield* CallHierarchyTool // kilocode_change
      const dependencyGraph = yield* DependencyGraphTool // kilocode_change
      const impactAnalysis = yield* ImpactAnalysisTool // kilocode_change
      const trace = yield* TraceTool // kilocode_change
      const symbolContext = yield* SymbolContextTool // kilocode_change
      const graphQuery = yield* GraphQueryTool // kilocode_change
      return { codebase, recall, manager, process, findReferences, callHierarchy, dependencyGraph, impactAnalysis, trace, symbolContext, graphQuery }
    })
  }

  /** Finalize Kilo-specific tools into Tool.Defs. Call this inside the InstanceState state Effect —
   * it has no Service deps beyond what Tool.init itself needs. */
  export function build(
    tools: { codebase: Tool.Info; recall: Tool.Info; manager: Tool.Info; process: Tool.Info; findReferences: Tool.Info; callHierarchy: Tool.Info; dependencyGraph: Tool.Info; impactAnalysis: Tool.Info; trace: Tool.Info; symbolContext: Tool.Info; graphQuery: Tool.Info },
    deps: Deps,
    loaders: Loaders = {},
  ) {
    return Effect.gen(function* () {
      const base = yield* Effect.all({
        codebase: Tool.init(tools.codebase),
        recall: Tool.init(tools.recall),
        manager: Tool.init(tools.manager),
        process: Tool.init(tools.process),
        findReferences: Tool.init(tools.findReferences), // kilocode_change
        callHierarchy: Tool.init(tools.callHierarchy), // kilocode_change
        dependencyGraph: Tool.init(tools.dependencyGraph), // kilocode_change
        impactAnalysis: Tool.init(tools.impactAnalysis), // kilocode_change
        trace: Tool.init(tools.trace), // kilocode_change
        symbolContext: Tool.init(tools.symbolContext), // kilocode_change
        graphQuery: Tool.init(tools.graphQuery), // kilocode_change
      })
      const semantic = yield* semanticTool(deps, loaders)
      return { ...base, semantic }
    })
  }

  function semanticTool(deps: Deps, loaders: Loaders) {
    return Effect.gen(function* () {
      const ready = yield* deps.indexing === undefined
        ? (() => {
            const indexing = loaders.indexing ?? (() => import("@/kilocode/indexing"))
            return Effect.tryPromise(() => indexing().then((mod) => mod.KiloIndexing.ready())).pipe(
              Effect.catch((err) =>
                Effect.sync(() => {
                  log.warn("semantic search unavailable", { err })
                  return false
                }),
              ),
            )
          })()
        : Effect.succeed(deps.indexing)
      if (!ready) return undefined

      const semantic = loaders.semantic ?? (() => import("@/kilocode/tool/semantic-search"))
      const mod = yield* Effect.tryPromise(() => semantic()).pipe(
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
    tools: { codebase: Tool.Def; semantic?: Tool.Def; recall: Tool.Def; manager: Tool.Def; process: Tool.Def; findReferences: Tool.Def; callHierarchy: Tool.Def; dependencyGraph: Tool.Def; impactAnalysis: Tool.Def; trace: Tool.Def; symbolContext: Tool.Def; graphQuery: Tool.Def },
    cfg: { experimental?: { codebase_search?: boolean } },
  ): Tool.Def[] {
    return [
      ...(cfg.experimental?.codebase_search === true ? [tools.codebase] : []),
      ...(tools.semantic ? [tools.semantic] : []),
      tools.recall,
      ...(Flag.KILO_CLIENT === "cli" || Flag.KILO_CLIENT === "vscode" ? [tools.process] : []),
      // The extension is the only client that can consume the Agent Manager start event.
      ...(Flag.KILO_CLIENT === "vscode" ? [tools.manager] : []),
      tools.findReferences, // kilocode_change
      tools.callHierarchy, // kilocode_change
      tools.dependencyGraph, // kilocode_change
      tools.impactAnalysis, // kilocode_change
      tools.trace, // kilocode_change
      tools.symbolContext, // kilocode_change
      tools.graphQuery, // kilocode_change
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
