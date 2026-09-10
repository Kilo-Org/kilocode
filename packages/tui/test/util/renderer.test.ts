import { expect, test } from "bun:test"
import type { CliRenderer } from "@opentui/core" // kilocode_change - type the screen-mode fixture
import { destroyRenderer } from "../../src/util/renderer"

// kilocode_change - verify main-screen restoration precedes renderer destruction.
test("clears the terminal title before destroying the renderer", () => {
  const calls: string[] = []
  let screenMode: CliRenderer["screenMode"] = "alternate-screen"
  destroyRenderer({
    isDestroyed: false,
    get screenMode() {
      return screenMode
    },
    setTerminalTitle(title) {
      calls.push(`title:${title}`)
    },
    set screenMode(mode) {
      screenMode = mode
      calls.push(`screen:${mode}`)
    },
    destroy() {
      calls.push("destroy")
    },
  })
  expect(calls).toEqual(["title:", "screen:main-screen", "destroy"])
})

// kilocode_change - an already destroyed renderer must not switch screen modes again.
test("still clears the title after renderer destruction", () => {
  const calls: string[] = []
  let screenMode: CliRenderer["screenMode"] = "alternate-screen"
  destroyRenderer({
    isDestroyed: true,
    get screenMode() {
      return screenMode
    },
    setTerminalTitle(title) {
      calls.push(`title:${title}`)
    },
    set screenMode(mode) {
      screenMode = mode
      calls.push(`screen:${mode}`)
    },
    destroy() {
      calls.push("destroy")
    },
  })
  expect(calls).toEqual(["title:"])
})
