import { Effect } from "effect"

type Client = {
  readonly transport?: unknown
  close(): Promise<void>
}

/**
 * Closes the clients the MCP state has connected so far. Registered before any server
 * starts, so it also covers a state lookup that is interrupted part way through, when the
 * upstream finalizer has not been registered yet and connected servers would otherwise
 * keep running with no owner. When the lookup completes, the upstream finalizer runs
 * first and empties `clients`, which makes this a no-op.
 */
export const release = (
  state: { clients: Record<string, Client> },
  descendants: (pid: number) => Effect.Effect<number[]>,
) =>
  Effect.suspend(() => {
    const clients = Object.values(state.clients)
    state.clients = {}
    return Effect.forEach(
      clients,
      (client) =>
        Effect.gen(function* () {
          // Only stdio transports have a server process.
          const transport = client.transport
          if (
            typeof transport === "object" &&
            transport !== null &&
            "pid" in transport &&
            typeof transport.pid === "number"
          ) {
            for (const child of yield* descendants(transport.pid)) {
              // The child may already have exited.
              yield* Effect.try({ try: () => process.kill(child, "SIGTERM"), catch: () => undefined }).pipe(
                Effect.ignore,
              )
            }
          }
          yield* Effect.tryPromise(() => client.close()).pipe(Effect.ignore)
        }),
      { concurrency: "unbounded", discard: true },
    )
  })
