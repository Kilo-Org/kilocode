import { describe, test, expect } from "bun:test"
import { Config } from "@/kilocode/session-export/config"

describe("session-export Config", () => {
  test("exposes hardcoded limits matching the spec", () => {
    expect(Config.maxPayloadBytes).toBe(50 * 1024 * 1024)
    expect(Config.maxSnapshotBytes).toBe(1 * 1024 * 1024 * 1024)
    expect(Config.chunkBytes).toBe(1 * 1024 * 1024)
    expect(Config.inlineThresholdBytes).toBe(64 * 1024)
    expect(Config.flushIntervalMs).toBe(60_000)
    expect(Config.flushSizeBytes).toBe(25 * 1024 * 1024)
    expect(Config.uploadRateLimitPerMinute).toBe(180)
    expect(Config.uploadRateLimitWindowMs).toBe(60_000)
    expect(Config.uploadRateLimitIntervalMs).toBe(Math.ceil(60_000 / 180))
    expect(Config.bufferCapBytes).toBe(50 * 1024 * 1024 * 1024)
    expect(Config.ringBufferBytes).toBe(256 * 1024 * 1024)
    expect(Config.baselineWaitMs).toBe(3_000)
    expect(Config.retryBackoffMinMs).toBe(1_000)
    expect(Config.retryBackoffMaxMs).toBe(5 * 60_000)
    expect(Config.shutdownFlushTimeoutMs).toBe(15_000)
  })
})
