import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "@opencode/cli/commands/commands"
import { Runtime } from "@opencode/cli/framework/runtime"
import { ServerConnection } from "@opencode/cli/services/server-connection"
import { errorMessage } from "@opencode/cli/util/error"
import { call, connect } from "../sync/shared"

const handler = Effect.fn("kilo.session.delete")(function* (
  input: Runtime.Input<typeof Commands.commands.session.commands.delete>,
) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  yield* Effect.tryPromise({
    try: (signal) => client.session.remove({ sessionID: input.sessionID }, { signal }),
    catch: (cause) => cause,
  })
  process.stdout.write(`Session ${input.sessionID} deleted${EOL}`)
  const synced = yield* connect({ server: Option.none(), standalone: false, directory: Option.none() }).pipe(
    Effect.flatMap((connection) =>
      call(() => connection.rpc.synced({ directory: connection.directory, sessionID: input.sessionID }, connection.options)),
    ),
    Effect.map((result) => result.synced),
    Effect.catch(() => Effect.succeed(false)),
  )
  if (synced)
    process.stdout.write(
      `The synced copy of session ${input.sessionID} remains. Run kilo2 sync delete ${input.sessionID} to delete it everywhere, or kilo2 sync pull ${input.sessionID} to restore it here.${EOL}`,
    )
})

export default Runtime.handler(Commands.commands.session.commands.delete, (input) =>
  handler(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
