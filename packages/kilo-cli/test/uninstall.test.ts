import { expect, test } from "bun:test"
import { uninstalled } from "../src/commands/uninstall"

// The upstream prints "Cancelled" and returns normally after a declined confirmation, so the exit code cannot tell it
// apart from a completed uninstall. The cache it removes first is the proof.
test("a declined confirmation does not count as an uninstall", () => {
  expect(uninstalled({}, { before: true, after: true })).toBeFalse()
  expect(uninstalled({}, { before: false, after: false })).toBeFalse()
  expect(uninstalled({}, { before: true, after: false })).toBeTrue()
})

test("--force never asks and a preview changes nothing", () => {
  expect(uninstalled({ force: true }, { before: true, after: true })).toBeTrue()
  expect(uninstalled({ dryRun: true }, { before: true, after: true })).toBeTrue()
})
