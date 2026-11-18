import { Runtime } from "@opencode/cli/framework/runtime"
import { installChromium } from "@kilocode/kilo-plugin/browser/install"
import { Effect } from "effect"
import { EOL } from "node:os"
import { KiloBrowserCommands } from "./commands"

const spec = KiloBrowserCommands.commands["install-chromium"]

export default Runtime.handler(
  spec,
  Effect.fnUntraced(function* (input: Runtime.Input<typeof spec>) {
    const installed = yield* Effect.tryPromise({
      try: () => installChromium({ force: input.force }),
      catch: (cause) => cause,
    })
    yield* Effect.sync(() => {
      process.stdout.write(
        [installed.executable, ...(installed.changed ? [] : ["(already installed)"])].join(" ") + EOL,
      )
    })
  }),
)
