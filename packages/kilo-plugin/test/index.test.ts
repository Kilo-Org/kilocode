import { expect, test } from "bun:test"
import plugin from "../src/index"

test("the Kilo plugin is defined on the public plugin API", () => {
  expect(plugin.id).toBe("kilo")
  expect(typeof plugin.effect).toBe("function")
})
