import { test, expect } from "bun:test"
import {
  parseShareUrl,
  transformShareData,
  bootstrapImportedSessionIngest,
  ingestBootstrapWarning,
  type ShareData,
} from "../../src/cli/cmd/import"

// parseShareUrl tests
test("parses valid Kilo share URLs", () => {
  expect(parseShareUrl("https://app.kilo.ai/s/7a755b04-b0fe-4e66-8b30-0ab52a181bd4")).toBe(
    "7a755b04-b0fe-4e66-8b30-0ab52a181bd4",
  )
  expect(parseShareUrl("https://app.kilo.ai/s/Jsj3hNIW")).toBe("Jsj3hNIW")
  expect(parseShareUrl("https://app.kilo.ai/s/test_id-123")).toBe("test_id-123")
})

test("rejects invalid URLs", () => {
  expect(parseShareUrl("https://app.kilo.ai/s/")).toBeNull()
  expect(parseShareUrl("https://app.kilo.ai/s/id/extra")).toBeNull()
  expect(parseShareUrl("https://opncd.ai/share/Jsj3hNIW")).toBeNull()
  expect(parseShareUrl("https://other.example.com/s/abc")).toBeNull()
  expect(parseShareUrl("not-a-url")).toBeNull()
})

// transformShareData tests
test("transforms share data to storage format", () => {
  const data: ShareData[] = [
    { type: "session", data: { id: "sess-1", title: "Test" } as any },
    { type: "message", data: { id: "msg-1", sessionID: "sess-1" } as any },
    { type: "part", data: { id: "part-1", messageID: "msg-1" } as any },
    { type: "part", data: { id: "part-2", messageID: "msg-1" } as any },
  ]

  const result = transformShareData(data)!

  expect(result.info.id).toBe("sess-1")
  expect(result.messages).toHaveLength(1)
  expect(result.messages[0].parts).toHaveLength(2)
})

test("returns null for invalid share data", () => {
  expect(transformShareData([])).toBeNull()
  expect(transformShareData([{ type: "message", data: {} as any }])).toBeNull()
  expect(transformShareData([{ type: "session", data: { id: "s" } as any }])).toBeNull() // no messages
})

test("formats ingest bootstrap warning", () => {
  expect(ingestBootstrapWarning("session-123", new Error("network failed"))).toContain("session-123")
  expect(ingestBootstrapWarning("session-123", new Error("network failed"))).toContain("network failed")
  expect(ingestBootstrapWarning("session-123", "oops")).toContain("oops")
})

test("bootstrapImportedSessionIngest runs bootstrap and does not warn on success", async () => {
  const calls: string[] = []
  const warnings: string[] = []

  await bootstrapImportedSessionIngest("session-success", {
    bootstrap: async (sessionId) => {
      calls.push(sessionId)
    },
    warn: (message) => warnings.push(message),
  })

  expect(calls).toEqual(["session-success"])
  expect(warnings).toHaveLength(0)
})

test("bootstrapImportedSessionIngest warns and continues on failure", async () => {
  const warnings: string[] = []

  await expect(
    bootstrapImportedSessionIngest("session-fail", {
      bootstrap: async () => {
        throw new Error("boom")
      },
      warn: (message) => warnings.push(message),
    }),
  ).resolves.toBeUndefined()

  expect(warnings).toHaveLength(1)
  expect(warnings[0]).toContain("session-fail")
  expect(warnings[0]).toContain("boom")
})
