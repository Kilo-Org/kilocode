import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { waitForPlugins } from "@opencode/cli/services/plugin-startup"
import { Runtime } from "@opencode/cli/framework/runtime"
import { ServerConnection } from "@opencode/cli/services/server-connection"
import { KiloPermissionsRpc } from "@opencode/schema/kilocode/permissions"
import { Effect, Option, Result } from "effect"
import { resolve } from "node:path"
import { failure, PermissionsCommand } from "./permissions"

export default Runtime.handler(
  PermissionsCommand.commands.check,
  Effect.fn("kilo.debug.permissions.check")(function* (input) {
    const directory = resolve(Option.getOrElse(input.directory, () => process.cwd()))
    const file = Bun.file(resolve(input.file))
    if (!(yield* Effect.promise(() => file.exists()))) {
      process.stderr.write(`error: file not found: ${resolve(input.file)}\n`)
      process.exitCode = 1
      return
    }
    const commands = yield* Effect.tryPromise(() => file.text()).pipe(
      Effect.map((text) =>
        text
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#")),
      ),
    )
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
    yield* waitForPlugins(client, directory)
    const checked = yield* Effect.tryPromise(() =>
      client
        .rpc(KiloPermissionsRpc.Definition)
        .check({ presetID: Option.getOrUndefined(input.preset), commands }, { location: { directory } }),
    ).pipe(Effect.result)
    if (Result.isFailure(checked)) {
      process.stderr.write(`error: ${failure(checked.failure)}\n`)
      process.exitCode = 1
      return
    }
    const asks = checked.success.results.filter((result) => result.missing.length > 0)
    process.stdout.write(
      `permissions: ${checked.success.presetID}, ${commands.length} commands: ${commands.length - asks.length} allowed, ${asks.length} ask\n`,
    )
    process.stdout.write(
      asks.map((result) => `ask  ${result.command}\n     not granted: ${result.missing.join(" | ")}\n`).join(""),
    )
  }),
)
