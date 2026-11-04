import { expect, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import { testEffect } from "../../core/test/lib/effect"
import { destination, SyncError } from "../src/sync/shared"

const it = testEffect(Layer.empty)

it.live("CLI destinations reject non-root paths without HTTP requests", () =>
  Effect.gen(function* () {
    const network = yield* Effect.acquireRelease(
      Effect.sync(() => spyOn(globalThis, "fetch")),
      (network) => Effect.sync(() => network.mockRestore()),
    )
    for (const [url, local] of [
      ["https://service.invalid/path", false],
      ["https://service.invalid/path/", false],
      ["https://service.invalid//", false],
      ["https://service.invalid/%2F", false],
      ["http://127.0.0.1:8080/path", true],
    ] as const) {
      const result = yield* destination(url, local).pipe(Effect.result)
      expect(result._tag).toBe("Failure")
      if (result._tag !== "Failure") throw new Error("A destination path must be rejected")
      expect(result.failure).toBeInstanceOf(SyncError)
      expect(result.failure.message).toBe("Destination URL must be an origin without a path.")
    }
    expect(network).toHaveBeenCalledTimes(0)
  }),
)

it.live("CLI destinations still accept HTTPS origins and opted-in loopback origins", () =>
  Effect.gen(function* () {
    expect(yield* destination("https://service.invalid", false)).toBe("https://service.invalid")
    expect(yield* destination("https://service.invalid/", false)).toBe("https://service.invalid")
    expect(yield* destination("http://127.0.0.1:8080/", true)).toBe("http://127.0.0.1:8080")
  }),
)
