import { expect, test } from "bun:test"
import { KiloPlugins, KiloPostPlugins } from "../src/index"

test("Gateway modes override built-in agents before config, and post-config steps keep policy, the ceiling, options and the free-tier filter", () => {
  expect(KiloPlugins.map((plugin) => plugin.id)).toEqual(["kilocode.handshake", "kilo.agent", "kilocode.gateway", "kilocode.provider-usage"])
  expect(KiloPostPlugins.map((plugin) => plugin.id)).toEqual([
    "kilocode.gateway.policy",
    "kilo.agent.ceiling",
    "kilocode.gateway.options",
    "kilocode.gateway.opencode-free-tier",
  ])
  expect([...KiloPlugins, ...KiloPostPlugins].every((plugin) => typeof plugin.effect === "function")).toBe(true)
})
