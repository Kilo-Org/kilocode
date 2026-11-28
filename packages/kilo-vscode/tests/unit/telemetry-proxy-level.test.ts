import { afterEach, describe, expect, it, spyOn } from "bun:test"
import * as vscode from "vscode"
import { TelemetryProxy } from "../../src/services/telemetry/telemetry-proxy"

const originalFetch = globalThis.fetch
const originalEnabled = vscode.env.isTelemetryEnabled

afterEach(() => {
  globalThis.fetch = originalFetch
  vscode.env.isTelemetryEnabled = originalEnabled
})

describe("TelemetryProxy.level", () => {
  it("recovers after the host permission update fails", async () => {
    vscode.env.isTelemetryEnabled = true
    const log = spyOn(console, "error").mockImplementation(() => {})
    const proxy = TelemetryProxy.getInstance()
    const paths: string[] = []

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      paths.push(path)
      if (path === "/telemetry/setEnabled") throw new Error("transient failure")
      return Response.json({ enabled: true })
    }) as typeof fetch

    try {
      proxy.configure("http://telemetry-proxy-level.test", "secret")
      expect(await proxy.level()).toBe(true)
      expect(paths).toContain("/telemetry/setEnabled")
      expect(paths.at(-1)).toBe("/telemetry/level")
    } finally {
      log.mockRestore()
    }
  })
})
