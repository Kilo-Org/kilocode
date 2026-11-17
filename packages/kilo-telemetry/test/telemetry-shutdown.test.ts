import { expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Telemetry } from "../src/telemetry"

// An endpoint that accepts the connection and never answers stands in for an unreachable PostHog (offline, firewall,
// DNS block). The bounded shutdown must not wait for the upload's retries and request timeouts.
test("shutdown is bounded by its timeout when the endpoint never answers", async () => {
  const hung = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Promise<Response>(() => {}) })
  try {
    await Telemetry.init({
      dataPath: mkdtempSync(path.join(tmpdir(), "kilo-telemetry-")),
      version: "1.0.0",
      enabled: true,
      host: hung.url.origin,
    })
    Telemetry.trackCliExit(0)
    const started = performance.now()
    await expect(Telemetry.shutdown(50)).rejects.toBeDefined()
    expect(performance.now() - started).toBeLessThan(1500)
    expect(Telemetry.initialized()).toBe(false)
  } finally {
    hung.stop(true)
  }
})
