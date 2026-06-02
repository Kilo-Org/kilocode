import { describe, expect, test } from "bun:test"
import { defaultEndpoint, resolveEndpoint } from "@/kilocode/session-export/worker/endpoint"

describe("session export endpoint", () => {
  test("rejects plaintext custom endpoints by default", () => {
    expect(resolveEndpoint({ endpoint: "http://example.test/ingest" })).toBe(defaultEndpoint)
  })

  test("allows approved production endpoint", () => {
    const endpoint = "https://supermassive-black-hole.kiloapps.io/v1/session-export/batch"
    expect(resolveEndpoint({ endpoint })).toBe(endpoint)
  })

  test("allows custom endpoints with explicit dev override", () => {
    expect(resolveEndpoint({ endpoint: "http://127.0.0.1:8787/batch", allowCustom: true })).toBe(
      "http://127.0.0.1:8787/batch",
    )
  })
})
