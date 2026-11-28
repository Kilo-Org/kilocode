import { describe, expect, test } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { Effect, Layer } from "effect"
import { DeepHealth } from "../../../src/kilocode/server/deep-health"

const mockDatabase = (run: () => Effect.Effect<unknown, unknown>) =>
  Layer.mock(Database.Service)({
    // The probe only touches db.run; every other drizzle member is covered by Layer.mock's proxy.
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    db: { run } as unknown as Database.Interface["db"],
  })

const runProbe = (layer: Layer.Layer<Database.Service>, timeout = "100 millis" as const) =>
  DeepHealth.probe(timeout).pipe(Effect.provide(layer), Effect.runPromise)

describe("DeepHealth.probe", () => {
  test("reports healthy when SELECT 1 succeeds through the production driver", async () => {
    const layer = mockDatabase(() => Effect.succeed([]))
    expect(await runProbe(layer)).toBe(true)
  })

  test("reports unhealthy when the database driver fails", async () => {
    const layer = mockDatabase(() => Effect.fail(new Error("database is locked")))
    expect(await runProbe(layer)).toBe(false)
  })

  test("reports unhealthy when the driver never settles (wedged permit)", async () => {
    const layer = mockDatabase(() => Effect.never)
    const start = Date.now()
    const healthy = await runProbe(layer)
    expect(healthy).toBe(false)
    // The injected 100ms budget, not the production 5s budget, bounds the test.
    expect(Date.now() - start).toBeLessThan(1_000)
  })

  test("defaults to the production 5 second timeout signature", () => {
    // Arity-zero call keeps the production budget used by the HTTP handler.
    expect(DeepHealth.probe.length).toBe(0)
  })
})
