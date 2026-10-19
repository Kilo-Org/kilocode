import { expect, test } from "bun:test"
import { KiloPlugins, KiloPostPlugins } from "../src/index"

test("the Kilo plugin lists hold the Gateway and agent plugins, with the agent ceiling in the post phase", () => {
  expect(KiloPlugins.map((plugin) => plugin.id)).toEqual(["kilocode.gateway", "kilo.agent"])
  expect(KiloPostPlugins.map((plugin) => plugin.id)).toEqual(["kilo.agent.ceiling"])
  expect([...KiloPlugins, ...KiloPostPlugins].every((plugin) => typeof plugin.effect === "function")).toBe(true)
})
