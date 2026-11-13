import { expect, test } from "bun:test"
import { KiloFlowPermissions } from "../../src/kilocode/flow-permissions.js"

test("checks one grant at a time with the server's messages", () => {
  expect(KiloFlowPermissions.check({ action: "shell", resource: "awk '{print $1,$2}' report.csv" })).toBeUndefined()
  expect(KiloFlowPermissions.check({ action: "external_directory", resource: "/home/user/*" })).toBeUndefined()
  expect(KiloFlowPermissions.check({ action: "external_directory", resource: "C:\\Users\\me\\*" })).toBeUndefined()
  expect(KiloFlowPermissions.check({ action: "*", resource: "*" })).toBe(
    "permission action * must name one concrete capability",
  )
  expect(KiloFlowPermissions.check({ action: "", resource: "*" })).toContain("(empty)")
  expect(KiloFlowPermissions.check({ action: "shell", resource: "/home/user/*" })).toContain(
    "use external_directory: /home/user/*",
  )
  expect(KiloFlowPermissions.check({ action: "external_directory", resource: "reports/*" })).toContain(
    "must use a bounded absolute wildcard below a directory",
  )
})

test("reports the first problem of an allowlist and recognizes the baseline", () => {
  expect(
    KiloFlowPermissions.validate([
      { action: "shell", resource: "npm test" },
      { action: "external_directory", resource: "*" },
    ]),
  ).toContain("external_directory permission *")
  expect(KiloFlowPermissions.validate(KiloFlowPermissions.baseline)).toBeUndefined()
  expect(KiloFlowPermissions.inBaseline({ action: "grep", resource: "*" })).toBeTrue()
  expect(KiloFlowPermissions.inBaseline({ action: "grep", resource: "src/*" })).toBeFalse()
})
