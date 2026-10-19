import { expect, test } from "bun:test"
import { KiloPlugins } from "../src/index"

test("the Kilo plugin list holds the Gateway plugin", () => {
  expect(KiloPlugins.map((plugin) => plugin.id)).toEqual(["kilocode.gateway"])
  expect(KiloPlugins.every((plugin) => typeof plugin.effect === "function")).toBe(true)
})
