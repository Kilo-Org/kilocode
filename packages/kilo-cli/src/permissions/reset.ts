import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { waitForPlugins } from "@opencode/cli/services/plugin-startup"
import { Runtime } from "@opencode/cli/framework/runtime"
import { ServerConnection } from "@opencode/cli/services/server-connection"
import { KiloPermissionsRpc } from "@opencode/schema/kilocode/permissions"
import { Effect, Option } from "effect"
import { resolve } from "node:path"
import { PermissionsCommand } from "./permissions"

export default Runtime.handler(
  PermissionsCommand.commands.reset,
  Effect.fn("kilo.permissions.reset")(function* (input) {
    const directory = resolve(Option.getOrElse(input.directory, () => process.cwd()))
    const server = yield* ServerConnection.resolve({
      server: Option.getOrUndefined(input.server),
      standalone: input.standalone,
    })
    const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
    yield* waitForPlugins(client, directory)
    const result = yield* Effect.tryPromise(() =>
      client.rpc(KiloPermissionsRpc.Definition).reset({ all: input.all }, { location: { directory } }),
    )
    process.stdout.write(
      input.all
        ? `permissions: reset-all ${directory} (removed ${result.removed} rules from applied sets)\n`
        : `permissions: reset ${directory}\n`,
    )
    process.stdout.write(
      "help: Restart an open TUI to show automatic permission setup offers again; saved permission grants are unchanged.\n",
    )
  }),
)
