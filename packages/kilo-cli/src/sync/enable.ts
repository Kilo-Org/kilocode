import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect, Option } from "effect"
import { SyncCommand } from "./sync"
import { call, connect, destination, printStatus, report, SyncError } from "./shared"

export default Runtime.handler(
  SyncCommand.commands.enable,
  Effect.fn("kilo.sync.enable")(function* (input) {
    const url = yield* destination(input.url, input.local)
    const connection = yield* connect(input)
    const organizationID = Option.isSome(input.organization)
      ? input.organization.value
      : (yield* call(() => connection.gateway.authStatus({}, connection.options))).organizationID
    if (organizationID !== null && organizationID.trim().length === 0)
      return yield* Effect.fail(new SyncError("Organization ID cannot be empty."))
    const status = yield* call(() =>
      connection.rpc.enable(
        {
          directory: connection.directory,
          destination: url,
          local: input.local,
          organizationID,
          assets: input.assets,
        },
        connection.options,
      ),
    )
    yield* printStatus(status, input.json)
    if (!status.enabled || status.error)
      yield* Effect.sync(() => {
        process.exitCode = 1
      })
  }, Effect.catch(report)),
)
