import { expect, test } from "bun:test"
import { KiloPlugins, KiloPostPlugins } from "../src/index"

test("Gateway modes override built-in agents before config, and post-config steps keep policy before the ceiling and options", () => {
  expect(KiloPlugins.map((plugin) => plugin.id)).toEqual(["kilocode.handshake", "kilo.agent", "kilocode.gateway", "kilocode.provider-usage"])
  expect(KiloPostPlugins.map((plugin) => plugin.id)).toEqual([
    "kilocode.gateway.policy",
    "kilo.agent.ceiling",
    "kilocode.gateway.options",
  ])
  expect([...KiloPlugins, ...KiloPostPlugins].every((plugin) => typeof plugin.effect === "function")).toBe(true)
})
