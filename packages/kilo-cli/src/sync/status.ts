import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect } from "effect"
import { SyncCommand } from "./sync"
import { call, connect, printStatus, report } from "./shared"

export default Runtime.handler(
  SyncCommand.commands.status,
  Effect.fn("kilo.sync.status")(function* (input) {
    const connection = yield* connect(input)
    const status = yield* call(() => connection.rpc.status({ directory: connection.directory }, connection.options))
    yield* printStatus(status, input.json)
  }, Effect.catch(report)),
)
