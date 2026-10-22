import { expect, test } from "bun:test"
import { KiloPlugins, KiloPostPlugins } from "../src/index"

test("the Kilo plugin lists keep the agent ceiling and Gateway option normalization after config", () => {
  expect(KiloPlugins.map((plugin) => plugin.id)).toEqual(["kilocode.handshake", "kilocode.gateway", "kilo.agent"])
  expect(KiloPostPlugins.map((plugin) => plugin.id)).toEqual(["kilo.agent.ceiling", "kilocode.gateway.options"])
  expect([...KiloPlugins, ...KiloPostPlugins].every((plugin) => typeof plugin.effect === "function")).toBe(true)
})
