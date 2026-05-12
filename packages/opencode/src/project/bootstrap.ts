import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "@/lsp/lsp"
import { File } from "../file"
import { Snapshot } from "../snapshot"
import * as Project from "./project"
import * as Vcs from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { InstanceState } from "@/effect/instance-state"
import { FileWatcher } from "@/file/watcher"
import { KilocodeBootstrap } from "@/kilocode/bootstrap" // kilocode_change
// import { ShareNext } from "@/share/share-next" // kilocode_change - handled by KilocodeBootstrap
import { Context, Effect, Layer } from "effect"
import { Config } from "@/config/config"

export interface Interface {
  readonly run: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstanceBootstrap") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    // Yield each bootstrap dep at layer init so `run` itself has R = never.
    // This breaks the circular declaration loop through Config → Instance → InstanceStore
    // (instance-store.ts only yields this Service tag, never the impl-side services).
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const file = yield* File.Service
    const fileWatcher = yield* FileWatcher.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const plugin = yield* Plugin.Service
    // const shareNext = yield* ShareNext.Service // kilocode_change - handled by KilocodeBootstrap
    const snapshot = yield* Snapshot.Service
    const vcs = yield* Vcs.Service

    const run = Effect.gen(function* () {
      const ctx = yield* InstanceState.context
      yield* Effect.logDebug("bootstrapping", { directory: ctx.directory }) // kilocode_change - was logInfo; downgraded to avoid printing to TUI on every startup
      // everything depends on config so eager load it for nice traces
      yield* config.get()
      // Plugin can mutate config so it has to be initialized before anything else.
      yield* plugin.init()
      yield* Effect.promise(() => KilocodeBootstrap.init()).pipe(Effect.forkDetach) // kilocode_change
      // kilocode_change start - shareNext removed from list, handled by KilocodeBootstrap
      yield* Effect.all(
        [
          lsp,
          format,
          file,
          fileWatcher,
          vcs,
          snapshot,
        ].map((s) => Effect.forkDetach(s.init())),
      ).pipe(Effect.withSpan("InstanceBootstrap.init"))
      // kilocode_change end

      const projectID = ctx.project.id
      yield* bus.subscribeCallback(Command.Event.Executed, async (payload) => {
        if (payload.properties.name === Command.Default.INIT) {
          Project.setInitialized(projectID)
        }
      })
    }).pipe(Effect.withSpan("InstanceBootstrap"))

    return Service.of({ run })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide([
    Bus.layer,
    Config.defaultLayer,
    File.defaultLayer,
    FileWatcher.defaultLayer,
    Format.defaultLayer,
    LSP.defaultLayer,
    Plugin.defaultLayer,
    Project.defaultLayer,
    // ShareNext.defaultLayer, // kilocode_change - handled by KilocodeBootstrap
    Snapshot.defaultLayer,
    Vcs.defaultLayer,
  ]),
)

export * as InstanceBootstrap from "./bootstrap"
