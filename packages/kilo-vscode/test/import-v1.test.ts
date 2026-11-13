import { expect, it } from "bun:test"
import { importV1 } from "../src/import-v1"

it("runs the server command with the import arguments instead of serve", async () => {
  const script = "console.log(JSON.stringify([process.argv.slice(1), process.env.KILO_V2_PROFILE]))"
  const result = await importV1({
    command: {
      cmd: process.execPath,
      args: ["-e", script, "serve", "--port", "0", "--stdio"],
      env: { KILO_V2_PROFILE: "p" },
    },
    cwd: process.cwd(),
    env: process.env,
    days: 14,
    log: () => undefined,
  })
  expect(result.ok).toBe(true)
  expect(JSON.parse(result.output)).toEqual([["import", "v1", "--since", "14d", "--config"], "p"])
})
