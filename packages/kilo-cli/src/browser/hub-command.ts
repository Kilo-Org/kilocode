// `kilo browser hub`: the process the browser runs as its native messaging host, or
// that a CLI starts detached when no hub is reachable.
import { Runtime } from "@opencode/cli/framework/runtime"
import { Effect } from "effect"
import { KiloBrowserCommands } from "./commands"

type Running = { done: Promise<void>; stop(): Promise<void> }

export default Runtime.handler(
  KiloBrowserCommands.commands.hub,
  Effect.fn("kilo.browser.hub")(function* (input) {
    if (input.native === input.loopback) {
      return yield* Effect.fail(new Error("choose exactly one of --native or --loopback"))
    }
    const running = yield* Effect.tryPromise({
      try: async (): Promise<Running> => {
        if (input.native) {
          const { run } = await import("./native")
          // The browser's positional arguments carry the calling extension's origin.
          return run({ argv: input.args.map((arg) => String(arg)) })
        }
        const { run } = await import("./loopback")
        return run({ port: input.port })
      },
      catch: (cause) => cause as Error,
    })
    // One owner for the shutdown: on SIGTERM and SIGINT, ShutdownDeadline interrupts
    // this fiber, and the finalizer drains the transports and removes the registry
    // entry. Without a signal the hub stops itself and `done` resolves.
    yield* Effect.addFinalizer(() => Effect.promise(() => running.stop()))
    yield* Effect.tryPromise({ try: () => running.done, catch: (cause) => cause as Error })
  }),
)
