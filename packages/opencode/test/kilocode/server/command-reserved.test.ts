import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../../src/server/server"
import type { Config } from "../../../src/config/config"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

void Log.init({ print: false })
setDefaultTimeout(90_000)

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
}, 15_000)

function req(dir: string, input: string) {
  return Server.Default().app.request(input, { headers: { "x-kilo-directory": dir } })
}

async function json<T>(response: Response) {
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return (await response.json()) as T
}

// Every client reads these two endpoints: the TUI, the VS Code extension, and the JetBrains
// plugin. Asserting the payloads is what proves a clash is visible in each of them rather
// than only in the server log.
describe("reserved command name over HTTP", () => {
  test("serves the full command list and reports the clash as a config warning", async () => {
    await using tmp = await tmpdir({ git: true })
    await Bun.write(
      path.join(tmp.path, "kilo.json"),
      JSON.stringify({
        command: {
          goal: { template: "Plugin goal: $ARGUMENTS", description: "Plugin goal" },
          ship: { template: "Ship it", description: "Ship the branch" },
        },
      }),
    )

    const commands = await json<{ name: string; source?: string; template?: unknown }[]>(
      await req(tmp.path, "/command"),
    )
    const names = commands.map((item) => item.name)
    expect(names).toContain("ship")
    expect(names).toContain("init")
    expect(commands.filter((item) => item.name === "goal")).toHaveLength(1)
    // The clashing template is reachable under the alias instead of being dropped.
    expect(names).toContain("goal:command")

    const warnings = await json<Config.Warning[]>(await req(tmp.path, "/config/warnings"))
    const clash = warnings.find((item) => item.path === "command.goal")
    expect(clash?.message).toContain('"goal" command registered by your config or a plugin')
    expect(clash?.message).toContain("reserved for Kilo's own command")
    expect(clash?.message).toContain("Run yours as /goal:command instead.")
  })
})
