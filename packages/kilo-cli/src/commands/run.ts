// kilo_mirror: packages/cli/src/commands/handlers/run.ts
import { Effect, Option } from "effect"
import { Commands } from "@opencode/cli/commands/commands"
import { Runtime } from "@opencode/cli/framework/runtime"
import { ServerConnection } from "@opencode/cli/services/server-connection"
import { waitForModel } from "@opencode/client/kilocode/model-startup"

export default Runtime.handler(Commands.commands.run, (input) =>
  Effect.gen(function* () {
    const { reportRunError, runNonInteractive } = yield* Effect.promise(() => import("@opencode/cli/run/run"))
    // A one-off run uses the background service when it is already up, but never leaves a new one running.
    const server = yield* ServerConnection.resolve({ autostart: false }).pipe(
      Effect.tapError((error) => Effect.logError("run could not resolve its server", { cause: error })),
      Effect.catch((error) => Effect.sync(() => reportRunError(input, error.message))),
    )
    if (!server) return
    // SIGINT and SIGTERM interrupt this fiber. Interruption waits for the run to cancel its Session and
    // jobs, so the private server and the process shut down only after that.
    yield* Effect.callback<void>((resume) => {
      const controller = new AbortController()
      const done = runNonInteractive(
        {
          server,
          message: [...input.message],
          continue: input.continue,
          session: Option.getOrUndefined(input.session),
          fork: input.fork,
          worktree: Option.getOrUndefined(input.worktree),
          model: Option.getOrUndefined(input.model),
          agent: Option.getOrUndefined(input.agent),
          format: input.format,
          file: [...input.file],
          title: Option.getOrUndefined(input.title),
          archived: input.archived,
          thinking: input.thinking,
          auto: input.auto || input.yolo || input.dangerouslySkipPermissions,
          // Kilo: plugin activation can finish before the catalog. Wait before creating or prompting the session.
          prepare: async (next) => {
            await waitForModel(next.client, { location: next.location, model: next.model, signal: controller.signal })
            return { model: next.model, agent: next.agent }
          },
        },
        controller.signal,
      ).then(() => resume(Effect.void))
      return Effect.promise(() => {
        controller.abort()
        return done
      })
    })
  }),
)
