import { OpenCode, type SessionInfo } from "@opencode/client"
import { KiloWakeupRpc } from "@opencode/schema/kilocode/wakeup"
import { Service } from "@opencode/client/effect/service"
import { Effect, Option, Stream } from "effect"
import { EOL } from "node:os"
import { Commands } from "@opencode/cli/commands/commands"
import { Runtime } from "@opencode/cli/framework/runtime"
import { ServerConnection } from "@opencode/cli/services/server-connection"
import { errorMessage } from "@opencode/cli/util/error"

const handler = Effect.fn("cli.session.list")(function* (
  input: Runtime.Input<typeof Commands.commands.session.commands.list>,
) {
  const server = yield* ServerConnection.resolve()
  const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
  const location = yield* Effect.tryPromise({
    try: (signal) => client.location.get({ location: { directory: process.cwd() } }, { signal }),
    catch: (cause) => cause,
  })
  const page = yield* Effect.tryPromise({
    try: (signal) =>
      client.session.list(
        {
          project: location.project.id,
          parentID: null,
          order: "desc",
          limit: Option.getOrElse(input.maxCount, () => 100),
        },
        { signal },
      ),
    catch: (cause) => cause,
  })
  if (input.format === "table" && page.data.length === 0) return
  // Kilo: a session asleep on a future wakeup is not idle, so read the directory's pending state for the status field.
  const scheduled = new Map<string, number>()
  for (const directory of new Set(page.data.map((session) => session.location.directory))) {
    const wakeups = client.rpc(KiloWakeupRpc.Definition) // kilo_port(wakeup:9d6803e786ab)
    const pending = yield* Effect.tryPromise({
      try: (signal) => wakeups.pending({ directory }, { signal, location: { directory } }),
      catch: (cause) => cause,
    }).pipe(Effect.option)
    if (Option.isNone(pending)) continue
    for (const item of pending.value.sessions)
      if (item.dueAt !== undefined) scheduled.set(item.sessionID, item.dueAt)
  }
  const output =
    (input.format === "json"
      ? JSON.stringify(
          page.data.map((session) => ({
            id: session.id,
            title: session.title,
            updated: session.time.updated,
            created: session.time.created,
            projectId: session.projectID,
            directory: session.location.directory,
            ...(scheduled.has(session.id)
              ? { scheduledAt: new Date(scheduled.get(session.id)!).toISOString() }
              : {}),
          })),
          null,
          2,
        )
      : formatList(page.data, scheduled)) + EOL
  const write = Effect.tryPromise(
    () =>
      new Promise<void>((resolve, reject) => {
        process.stdout.write(output, (error) => (error ? reject(error) : resolve()))
      }),
  )
  if (!process.stdout.isTTY || Option.isSome(input.maxCount) || input.format === "json") {
    yield* write
    return
  }

  const { AppProcess } = yield* Effect.promise(() => import("@opencode/util/process"))
  const { LayerNode } = yield* Effect.promise(() => import("@opencode/util/effect/layer-node"))
  const { ChildProcess } = yield* Effect.promise(() => import("effect/process"))
  yield* Effect.gen(function* () {
    const processService = yield* AppProcess.Service
    const pager = yield* processService
      .spawn(
        ChildProcess.make(
          process.platform === "win32" ? "cmd" : "less",
          process.platform === "win32" ? ["/c", "more"] : ["-R", "-S"],
          {
            stdin: Stream.make(new TextEncoder().encode(output)),
            stdout: "inherit",
            stderr: "inherit",
          },
        ),
      )
      .pipe(Effect.option)
    if (Option.isNone(pager)) {
      yield* write
      return
    }
    yield* pager.value.exitCode
  }).pipe(Effect.provide(LayerNode.compile(AppProcess.node)))
})

export default Runtime.handler(Commands.commands.session.commands.list, (input) =>
  handler(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)

export function formatList(sessions: ReadonlyArray<SessionInfo>, scheduled: ReadonlyMap<string, number>) {
  return sessions
    .map((session) => {
      const dueAt = scheduled.get(session.id)
      const fields = [
        session.id,
        (session.title ?? "Untitled session").replace(/[\r\n\t]/g, " "),
        new Date(session.time.updated).toLocaleString(),
      ]
      if (dueAt !== undefined) fields.push(`scheduled ${new Date(dueAt).toISOString()}`)
      return fields.join("\t")
    })
    .join(EOL)
}
