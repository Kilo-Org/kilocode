import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect } from "effect"
import { EOL } from "node:os"
import { SyncCommand } from "./sync"
import { call, connect, report, sanitize } from "./shared"

export default Runtime.handler(
  SyncCommand.commands.delete,
  Effect.fn("kilo.sync.delete")(function* (input) {
    const connection = yield* connect(input)
    const result = yield* call(() =>
      connection.rpc.deleteSession({ directory: connection.directory, sessionID: input.sessionID }, connection.options),
    )
    yield* Effect.sync(() => {
      process.stdout.write((input.json ? JSON.stringify(result) : sanitize(result.message)) + EOL)
      if (!result.deleted) process.exitCode = 1
    })
  }, Effect.catch(report)),
)
