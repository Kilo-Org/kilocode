import { Plugin } from "../plugin"
import { Format } from "../format"
import { LSP } from "../lsp"
import { File } from "../file"
import { Snapshot } from "../snapshot"
import { Project } from "./project"
import { Vcs } from "./vcs"
import { Bus } from "../bus"
import { Command } from "../command"
import { Instance } from "./instance"
import { Log } from "@/util/log"
import { FileWatcher } from "@/file/watcher"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions" // kilocode_change
import * as Effect from "effect/Effect"

export const InstanceBootstrap = Effect.gen(function* () {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  yield* Plugin.Service.use((svc) => svc.init())
  // kilocode_change start - bootstrap Kilo session ingest/remote subscriptions instead of ShareNext
  yield* Effect.promise(() => KiloSessions.init()).pipe(Effect.forkDetach)
  yield* Effect.all(
    [LSP.Service, Format.Service, File.Service, FileWatcher.Service, Vcs.Service, Snapshot.Service].map((s) =>
      Effect.forkDetach(s.use((i) => i.init())),
  ),
  // kilocode_change end
  )

  yield* Bus.Service.use((svc) =>
    svc.subscribeCallback(Command.Event.Executed, async (payload) => {
      if (payload.properties.name === Command.Default.INIT) {
        Project.setInitialized(Instance.project.id)
      }
    }),
  )
}).pipe(Effect.withSpan("InstanceBootstrap"))
