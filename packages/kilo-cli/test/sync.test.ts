import { expect, test, spyOn } from "bun:test"
import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { Command } from "effect/cli"
import { SyncCommand } from "../src/sync/sync"

for (const args of [["enable", "--url", "https://other.invalid"], ["enable", "--local"], ["flush", "--all"]])
  test(`sync rejects removed option ${args.join(" ")} without network access`, async () => {
    const network = spyOn(globalThis, "fetch")
    try {
      const run = args[0] === "enable"
        ? Command.runWith(SyncCommand.commands.enable.spec.pipe(Command.withHandler(() => Effect.void)), { version: "test" })
        : Command.runWith(SyncCommand.commands.flush.spec.pipe(Command.withHandler(() => Effect.void)), { version: "test" })
      const result = await Effect.runPromise(
        run(args.slice(1)).pipe(
          Effect.provide(NodeServices.layer),
          Effect.result,
        ),
      )
      expect(result._tag).toBe("Failure")
      expect(network).not.toHaveBeenCalled()
    } finally {
      network.mockRestore()
    }
  })
