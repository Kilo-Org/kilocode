import { describe, expect, test } from "bun:test"
import { designMetadata } from "../../../src/kilocode/design/metadata"
import type { Turn } from "../../../src/kilocode/design/state"

describe("designMetadata", () => {
  test("builds metadata for a voice turn", () => {
    const turn: Turn = { id: "turn_001", text: "make it blue", queued: false, latencyMs: 120 }
    expect(designMetadata(turn, { input: "voice", target: "http://localhost:3000" })).toEqual({
      source: "design-mode",
      input: "voice",
      turnId: "turn_001",
      queued: false,
      latencyMs: 120,
      target: "http://localhost:3000",
    })
  })

  test("omits optional fields when absent", () => {
    const turn: Turn = { id: "turn_002", text: "go", queued: true }
    expect(designMetadata(turn, { input: "fake" })).toEqual({
      source: "design-mode",
      input: "fake",
      turnId: "turn_002",
      queued: true,
    })
  })
})
