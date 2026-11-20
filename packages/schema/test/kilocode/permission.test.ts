import { expect, test } from "bun:test"
import { KiloPermission } from "../../src/kilocode/permission.js"

test("requiresPerson counts only a literal true", () => {
  expect(KiloPermission.requiresPerson({ interactive: true })).toBeTrue()
  expect(KiloPermission.requiresPerson({ interactive: "true" })).toBeFalse()
  expect(KiloPermission.requiresPerson({ interactive: 1 })).toBeFalse()
  expect(KiloPermission.requiresPerson({ interactive: false })).toBeFalse()
  expect(KiloPermission.requiresPerson({ command: "git add a.txt" })).toBeFalse()
  expect(KiloPermission.requiresPerson(undefined)).toBeFalse()
})
