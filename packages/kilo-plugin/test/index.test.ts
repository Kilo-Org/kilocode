import { expect, test } from "bun:test"
import { KiloPlugins, KiloPostPlugins } from "../src/index"

test("the Kilo plugin lists keep the agent ceiling, Gateway options and the OpenCode free-tier filter after config", () => {
  expect(KiloPlugins.map((plugin) => plugin.id)).toEqual(["kilocode.handshake", "kilocode.gateway", "kilo.agent"])
  expect(KiloPostPlugins.map((plugin) => plugin.id)).toEqual([
    "kilo.agent.ceiling",
    "kilocode.gateway.options",
    "kilocode.gateway.opencode-free-tier",
  ])
  expect([...KiloPlugins, ...KiloPostPlugins].every((plugin) => typeof plugin.effect === "function")).toBe(true)
})
