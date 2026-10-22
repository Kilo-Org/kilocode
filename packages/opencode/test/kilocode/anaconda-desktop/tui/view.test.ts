import { expect, test } from "bun:test"
import type { AnacondaDesktopStatus } from "@kilocode/sdk/v2"
import { DOWNLOAD_URL } from "../../../../src/kilocode/anaconda-desktop/domain"
import { setupView } from "../../../../src/kilocode/anaconda-desktop/tui/model"

const ready = (toolcall: "supported" | "unsupported" | "unknown" = "supported"): AnacondaDesktopStatus => ({
  type: "ready",
  serverID: "server-1",
  models: [{ id: "model-1", name: "Local Model" }],
  context: 8192,
  toolcall,
})

test("maps setup states to their consequential actions", () => {
  const cases: Array<{ status: AnacondaDesktopStatus; action?: "download" | "open" | "connect" }> = [
    { status: { type: "unsupported-platform", platform: "freebsd" } },
    { status: { type: "not-installed", downloadURL: DOWNLOAD_URL }, action: "download" },
    { status: { type: "not-running" }, action: "open" },
    { status: { type: "invalid-config", reason: "missing-key" }, action: "open" },
    { status: { type: "signed-out" }, action: "open" },
    { status: { type: "management-unauthorized" }, action: "open" },
    { status: { type: "management-unavailable", reason: "timeout" }, action: "open" },
    { status: { type: "no-downloaded-model" }, action: "open" },
    { status: { type: "no-running-server", downloadedModels: 2 }, action: "open" },
    { status: { type: "inference-unhealthy", serverID: "server-1" }, action: "open" },
    { status: ready(), action: "connect" },
  ]

  for (const item of cases) {
    const view = setupView(item.status)
    expect(view.actions.at(-1)?.type).toBe("refresh")
    expect(view.actions.some((action) => action.type === item.action)).toBe(item.action !== undefined)
  }
})

test("requires explicit continuation for limited tool support", () => {
  for (const toolcall of ["unsupported", "unknown"] as const) {
    const view = setupView(ready(toolcall))
    expect(view.warning).toBe(true)
    expect(view.actions.find((action) => action.type === "connect")?.label).toBe("connect anyway")
  }
})
