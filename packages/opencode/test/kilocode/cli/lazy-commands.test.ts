import { describe, expect, test } from "bun:test"
import yargs from "yargs"
import { hasLazyCommandSelection, lazy } from "../../../src/kilocode/cli/lazy-commands"

describe("lazy CLI command", () => {
  test("loads once after command selection", async () => {
    const calls: string[] = []
    const command = lazy({
      command: "sample",
      describe: "sample command",
      async load() {
        calls.push("load")
        return {
          command: "sample",
          describe: "sample command",
          builder: (args) => args.option("value", { type: "string", demandOption: true }),
          handler: (args) => {
            calls.push(String(args.value))
          },
        }
      },
    })
    const cli = yargs([]).exitProcess(false).command(command)

    expect(calls).toEqual([])
    await cli.parseAsync(["sample", "--value", "ready"])
    expect(calls).toEqual(["load", "ready"])
    expect(hasLazyCommandSelection()).toBe(true)
  })

  test("preserves builder validation", async () => {
    const command = lazy({
      command: "sample",
      describe: "sample command",
      async load() {
        return {
          command: "sample",
          describe: "sample command",
          builder: (args) => args.option("value", { type: "string", demandOption: true }),
          handler() {},
        }
      },
    })

    await expect(yargs([]).exitProcess(false).command(command).parseAsync(["sample"])).rejects.toThrow(
      "Missing required argument: value",
    )
  })
})
