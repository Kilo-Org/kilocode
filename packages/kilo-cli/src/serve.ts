// Mirror of packages/cli/src/commands/handlers/serve.ts (v2.0.30). The only difference: the server gets the Kilo
// overrides.
import { Commands } from "@opencode/cli/commands/commands"
import { Runtime } from "@opencode/cli/framework/runtime"
import { ServerProcess } from "@opencode/cli/server-process"
import { Effect, Option } from "effect"
import { KiloHost } from "./host"

export default Runtime.handler(
  Commands.commands.serve,
  Effect.fnUntraced(function* (input) {
    if (input.service && input.stdio) return yield* Effect.fail(new Error("--service and --stdio cannot be combined"))
    return yield* ServerProcess.run({
      mode: input.service ? "service" : input.stdio ? "stdio" : "default",
      hostname: Option.getOrUndefined(input.hostname),
      port: Option.getOrUndefined(input.port),
      cors: input.cors.length > 0 ? input.cors : undefined,
      overrides: KiloHost.overrides,
    })
  }),
)
