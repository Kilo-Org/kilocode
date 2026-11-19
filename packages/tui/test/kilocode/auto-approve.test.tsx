import { beforeEach, describe, expect, it, test } from "bun:test"
import { permissionModeOverride, setPermissionMode, togglePermissionMode } from "../../src/kilocode/permission-mode"
import { createAppFixture } from "../fixture/app"

beforeEach(() => setPermissionMode(undefined))

describe("auto-approve mode", () => {
  it("applies the configured mode until it is toggled", () => {
    expect(permissionModeOverride()).toBeUndefined()
  })

  it("toggles from the effective mode and keeps the override", () => {
    expect(togglePermissionMode("prompt")).toBe("autoaccept")
    expect(permissionModeOverride()).toBe("autoaccept")
    expect(togglePermissionMode("autoaccept")).toBe("prompt")
    expect(permissionModeOverride()).toBe("prompt")
  })

  it("falls back to the configured mode when the override is cleared", () => {
    togglePermissionMode("prompt")
    setPermissionMode(undefined)
    expect(permissionModeOverride()).toBeUndefined()
  })
})

test(
  "/yolo and Ctrl+Alt+A toggle auto-approve",
  async () => {
    await using app = await createAppFixture()
    await app.ready
    await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))

    await app.mockInput.typeText("/auto-approve")
    app.mockInput.pressEnter()
    await app.waitForFrame((frame) => frame.includes("Auto-approve enabled."))

    app.mockInput.pressKey("a", { ctrl: true, meta: true })
    await app.waitForFrame((frame) => frame.includes("Auto-approve disabled."))

    expect(app.captureCharFrame()).not.toContain("Auto-approve enabled.")
  },
  30000,
)
