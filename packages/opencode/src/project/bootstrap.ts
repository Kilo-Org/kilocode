import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "@/lsp/lsp"
import { Snapshot } from "../snapshot"
import * as Project from "./project"
import * as Vcs from "./vcs"
import { InstanceState } from "@/effect/instance-state"
// kilocode_change start - ShareNext init is handled by KilocodeBootstrap; upstream dropped File/FileWatcher bootstrap init
import { KilocodeBootstrap } from "@/kilocode/bootstrap"
// import { ShareNext } from "@/share/share-next"
// kilocode_change end
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { Service } from "./bootstrap-service"

export { Service } from "./bootstrap-service"
export type { Interface } from "./bootstrap-service"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // Yield each bootstrap dep at layer init so `run` itself has R = never.
    // InstanceStore imports only the lightweight tag from bootstrap-service.ts,
    // so it can depend on bootstrap without importing this implementation graph.
    const config = yield* Config.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const plugin = yield* Plugin.Service
    const project = yield* Project.Service
    // kilocode_change start
    const kilocode = yield* KilocodeBootstrap.Service
    // const shareNext = yield* ShareNext.Service
    // kilocode_change end
    const snapshot = yield* Snapshot.Service
    const vcs = yield* Vcs.Service

    const run = Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* Effect.logDebug("bootstrapping", { directory: ctx.directory }) // kilocode_change - avoid printing on every startup
      // everything depends on config so eager load it for nice traces
      yield* config.get()
      // Plugin can mutate config so it has to be initialized before anything else.
      yield* plugin.init()
      yield* kilocode.init().pipe(Effect.catchCause((cause) => Effect.logWarning("kilocode init failed", { cause }))) // kilocode_change
      // Each service self-manages its own slow work via Effect.forkScoped against
      // its per-instance state scope. We just await materialization here.
      yield* Effect.forEach(
        [lsp, format, vcs, snapshot, project], // kilocode_change - KilocodeBootstrap owns ShareNext initialization
        (s) => s.init().pipe(Effect.catchCause((cause) => Effect.logWarning("init failed", { cause }))),
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.withSpan("InstanceBootstrap.init"))
    }).pipe(Effect.withSpan("InstanceBootstrap"))

    return Service.of({ run })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide([
    Config.defaultLayer,
    Format.defaultLayer,
    LSP.defaultLayer,
    Plugin.defaultLayer,
    Project.defaultLayer,
    // kilocode_change start
    KilocodeBootstrap.defaultLayer,
    // ShareNext.defaultLayer,
    // kilocode_change end
    Snapshot.defaultLayer,
    Vcs.defaultLayer,
  ]),
)

export const node = LayerNode.make(layer, [
  Config.node,
  Format.node,
  LSP.node,
  Plugin.node,
  Project.node,
  KilocodeBootstrap.node, // kilocode_change
  Snapshot.node,
  Vcs.node,
])

export * as InstanceBootstrap from "./bootstrap"
