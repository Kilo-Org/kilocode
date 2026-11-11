import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect } from "effect"
import { SyncCommand } from "./sync"
import { call, connect, printStatus, report } from "./shared"

export default Runtime.handler(
  SyncCommand.commands.flush,
  Effect.fn("kilo.sync.flush")(function* (input) {
    const connection = yield* connect(input)
    const status = yield* call(() => connection.rpc.flush({ directory: connection.directory }, connection.options))
    yield* printStatus(status, input.json)
    if (status.pending > 0 || status.error)
      yield* Effect.sync(() => {
        process.exitCode = 1
      })
  }, Effect.catch(report)),
)
