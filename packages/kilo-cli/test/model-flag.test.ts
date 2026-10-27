import { expect, test } from "bun:test"
import { NodeServices } from "@effect/platform-node"
import { Commands } from "@opencode/cli/commands/commands"
import { Effect, Option } from "effect"
import { Command } from "effect/cli"

test.each([[], ["--model", "kilo/selected"], ["-m", "kilo/selected"], ["--model=kilo/selected"]])(
  "parses the optional full-TUI model flag %j without changing omitted behavior",
  async (...args) => {
    const command = Commands.spec.pipe(
      Command.withHandler((input) =>
        Effect.sync(() => {
          expect(Option.getOrUndefined(input.model)).toBe(args.length ? "kilo/selected" : undefined)
          expect(input.standalone).toBe(true)
        }),
      ),
    )
    await Effect.runPromise(
      Command.runWith(command, { version: "test" })(["--standalone", ...args]).pipe(Effect.provide(NodeServices.layer)),
    )
  },
)
