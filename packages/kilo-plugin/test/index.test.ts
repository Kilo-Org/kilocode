import { expect, test } from "bun:test"
import { KiloPlugins, KiloPostPlugins } from "../src/index"

test("Gateway modes override built-in agents before config, with the agent ceiling in the post phase", () => {
  expect(KiloPlugins.map((plugin) => plugin.id)).toEqual(["kilocode.handshake", "kilo.agent", "kilocode.gateway"])
  expect(KiloPostPlugins.map((plugin) => plugin.id)).toEqual(["kilocode.gateway.policy", "kilo.agent.ceiling"])
  expect([...KiloPlugins, ...KiloPostPlugins].every((plugin) => typeof plugin.effect === "function")).toBe(true)
})
