import { expect, test } from "bun:test"
import { Renderable } from "@opentui/core"
import { getComponentCatalogue } from "@opentui/solid/components"
import { registerOpencodeSpinner } from "../../src/component/register-spinner"

test("spinner uses the active OpenTUI runtime", () => {
  registerOpencodeSpinner()
  const spinner = getComponentCatalogue().spinner
  expect(spinner).toBeDefined()
  expect(spinner?.prototype).toBeInstanceOf(Renderable)
})
