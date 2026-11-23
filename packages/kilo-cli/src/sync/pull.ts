import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect } from "effect"
import { EOL } from "node:os"
import { SyncCommand } from "./sync"
import { call, connect, report, sanitize } from "./shared"

export default Runtime.handler(
  SyncCommand.commands.pull,
  Effect.fn("kilo.sync.pull")(function* (input) {
    const connection = yield* connect(input)
    const result = yield* call(() =>
      connection.rpc.pull(
        {
          directory: connection.directory,
          sessionID: input.sessionID,
          replaceLocal: input.replaceLocal,
          asNew: input.asNew,
        },
        connection.options,
      ),
    )
    yield* Effect.sync(() => {
      process.stdout.write((input.json ? JSON.stringify(result) : sanitize(result.message)) + EOL)
    })
  }, Effect.catch(report)),
)
