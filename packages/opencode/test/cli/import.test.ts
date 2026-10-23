import { test, expect } from "bun:test"
import {
  formatImportFileError,
  parseShareUrl,
  transformShareData,
  bootstrapImportedSessionIngest,
  ingestBootstrapWarning,
  shouldAttachShareAuthHeaders,
  decodeImportMessages, // kilocode_change
  formatImportWriteError, // kilocode_change
  type ShareData,
} from "../../src/cli/cmd/import"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Cause, PlatformError } from "effect" // kilocode_change
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError" // kilocode_change
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors" // kilocode_change
import { assistantMessage, malformedToolPartDocument, textPart, toolPart, userMessage } from "../fixture/import" // kilocode_change

test("formats import file errors", () => {
  expect(
    formatImportFileError(
      "test.json",
      new PlatformError.PlatformError(
        new PlatformError.SystemError({
          _tag: "NotFound",
          module: "FileSystem",
          method: "readFileString",
        }),
      ),
    ),
  ).toBe("File not found: test.json")
  expect(
    formatImportFileError(
      "test.json",
      new PlatformError.PlatformError(
        new PlatformError.SystemError({
          _tag: "PermissionDenied",
          module: "FileSystem",
          method: "readFileString",
        }),
      ),
    ),
  ).toBe("Failed to read file: Permission denied")
  expect(
    formatImportFileError(
      "test.json",
      new FSUtil.FileSystemError({ method: "readJson", cause: new SyntaxError("Unexpected token") }),
    ),
  ).toBe("Invalid JSON in test.json: Unexpected token")
})

// parseShareUrl tests
test("parses valid Kilo share URLs", () => {
  expect(parseShareUrl("https://app.kilo.ai/s/7a755b04-b0fe-4e66-8b30-0ab52a181bd4")).toBe(
    "7a755b04-b0fe-4e66-8b30-0ab52a181bd4",
  )
  expect(parseShareUrl("https://app.kilo.ai/s/Jsj3hNIW")).toBe("Jsj3hNIW")
  expect(parseShareUrl("https://app.kilo.ai/s/test_id-123")).toBe("test_id-123")
  // kilocode_change start
  expect(
    parseShareUrl(
      "https://app.kilo.ai/s/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZXNfMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMiJ9.signature",
    ),
  ).toBe("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZXNfMTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMiJ9.signature")
  // kilocode_change end
})

test("rejects invalid URLs", () => {
  expect(parseShareUrl("https://app.kilo.ai/s/")).toBeNull()
  expect(parseShareUrl("https://app.kilo.ai/s/id/extra")).toBeNull()
  expect(parseShareUrl("https://opncd.ai/share/Jsj3hNIW")).toBeNull()
  expect(parseShareUrl("https://other.example.com/s/abc")).toBeNull()
  expect(parseShareUrl("not-a-url")).toBeNull()
})

test("only attaches share auth headers for same-origin URLs", () => {
  expect(shouldAttachShareAuthHeaders("https://control.example.com/share/abc", "https://control.example.com")).toBe(
    true,
  )
  expect(shouldAttachShareAuthHeaders("https://other.example.com/share/abc", "https://control.example.com")).toBe(false)
  expect(shouldAttachShareAuthHeaders("https://control.example.com:443/share/abc", "https://control.example.com")).toBe(
    true,
  )
  expect(shouldAttachShareAuthHeaders("not-a-url", "https://control.example.com")).toBe(false)
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

// kilocode_change start - pre-flight validation of the whole document and the store-write failure path
// decodeImportMessages tests
test("decodeImportMessages decodes a valid document", () => {
  const decoded = decodeImportMessages([
    { info: userMessage(1), parts: [textPart("msg_000000000001", 1)] },
    { info: assistantMessage(2), parts: [toolPart("msg_000000000002", 2), textPart("msg_000000000002", 3)] },
  ])

  expect(decoded).toHaveLength(2)
  expect(String(decoded[0].info.id)).toBe("msg_000000000001")
  expect(decoded[0].info.role).toBe("user")
  expect(decoded[0].parts).toHaveLength(1)
  expect(decoded[1].info.role).toBe("assistant")
  expect(decoded[1].parts).toHaveLength(2)
  expect(decoded[1].parts[0]).toMatchObject({ type: "tool", callID: "call_2" })
  expect(decoded[1].parts[1]).toMatchObject({ type: "text", text: "hello" })
})

test("decodeImportMessages rejects a malformed part and reports both indexes", () => {
  expect(() => decodeImportMessages(malformedToolPartDocument())).toThrow(/Invalid part 0 of message 1/)
  expect(() => decodeImportMessages(malformedToolPartDocument())).toThrow(/title/)
})

test("decodeImportMessages rejects a malformed message and reports its index", () => {
  const document = [
    { info: userMessage(1), parts: [] },
    { info: { role: "user" }, parts: [] },
  ]

  expect(() => decodeImportMessages(document)).toThrow(/Invalid message 1/)
})

test("decodeImportMessages rejects documents without a messages array", () => {
  expect(() => decodeImportMessages(undefined)).toThrow(/no "messages" array/)
  expect(() => decodeImportMessages(null)).toThrow(/no "messages" array/)
  expect(() => decodeImportMessages({})).toThrow(/no "messages" array/)
})

test("decodeImportMessages rejects a message without a parts array", () => {
  const document = [{ info: userMessage(1), parts: [textPart("msg_000000000001", 1)] }, { info: assistantMessage(2) }]

  expect(() => decodeImportMessages(document)).toThrow('Message 1 has no "parts" array')
})

test("decodeImportMessages names the offending value when a message is not an object", () => {
  // These have no `parts` field at all, so "has no parts array" would point at the
  // wrong reason; the message has to say what it actually got.
  expect(() => decodeImportMessages([null])).toThrow("Message 0 is not an object (got null)")
  expect(() => decodeImportMessages([[]])).toThrow("Message 0 is not an object (got object)")
  expect(() => decodeImportMessages(["x"])).toThrow("Message 0 is not an object (got string)")
  expect(() => decodeImportMessages([42])).toThrow("Message 0 is not an object (got number)")
})

// formatImportWriteError tests
const sqlError = (cause: unknown) =>
  new SqlError({
    reason: new UnknownError({ cause, message: "Failed to execute statement", operation: "execute" }),
  })

test("formatImportWriteError unwraps a drizzle failure to the sqlite reason", () => {
  const error = new EffectDrizzleQueryError({
    query: "insert into kv_secret values (?)",
    params: ["<redacted>"],
    cause: Cause.fail(sqlError(new Error("FOREIGN KEY constraint failed"))),
  })

  expect(formatImportWriteError(error)).toBe("FOREIGN KEY constraint failed")
  // The statement/params are redacted by drizzle and must never reach the user.
  expect(formatImportWriteError(error)).not.toContain("<redacted>")
})

test("formatImportWriteError unwraps a nested drizzle wrapper", () => {
  // The wrapper is not always the outermost value: a layer that wraps its own
  // errors again puts the inner wrapper inside the cause, so the unwrapping has
  // to keep recursing until it reaches the sqlite reason.
  const error = new EffectDrizzleQueryError({
    query: "insert into kv_secret values (?)",
    params: ["<redacted>"],
    cause: Cause.fail(
      new EffectDrizzleQueryError({
        query: "insert into kv_secret values (?)",
        params: ["<redacted>"],
        cause: Cause.fail(sqlError(new Error("FOREIGN KEY constraint failed"))),
      }),
    ),
  })

  expect(formatImportWriteError(error)).toBe("FOREIGN KEY constraint failed")
})

test("formatImportWriteError reports the reason of a bare SqlError", () => {
  // begin/commit failures are not wrapped by drizzle.
  expect(formatImportWriteError(sqlError(new Error("disk I/O error")))).toBe("disk I/O error")
})

test("formatImportWriteError falls back when the cause holds no failure", () => {
  const error = new EffectDrizzleQueryError({
    query: "select 1",
    params: ["<redacted>"],
    cause: Cause.die("boom"),
  })

  expect(formatImportWriteError(error)).toContain("Failed query")
})

test("formatImportWriteError falls back to the reason message then the reason tag", () => {
  expect(formatImportWriteError(sqlError(undefined))).toBe("Failed to execute statement")
  expect(formatImportWriteError(sqlError(null))).toBe("Failed to execute statement")

  const bare = new SqlError({ reason: new UnknownError({ cause: undefined, operation: "execute" }) })
  expect(formatImportWriteError(bare)).toBe("UnknownError")
})

test("formatImportWriteError passes through errors that are not sql failures", () => {
  expect(formatImportWriteError(new Error("no database here"))).toBe("no database here")
  expect(formatImportWriteError("plain string")).toBe("plain string")
})

// The unwrapping recurses through `cause` chains, so it has to terminate on a
// cyclic one. This runs on the write-failure path, which only executes after the
// transaction has already rolled back, so hanging here would turn a diagnosed
// failure into a stuck command.
test("formatImportWriteError terminates on a self-referencing cause", () => {
  const self: Record<string, unknown> = {}
  self["cause"] = self
  expect(formatImportWriteError(self)).toBeDefined()
})

test("formatImportWriteError terminates on a cyclic cause chain", () => {
  const first: Record<string, unknown> = {}
  const second: Record<string, unknown> = { cause: first }
  first["cause"] = second
  expect(formatImportWriteError(first)).toBeDefined()
  expect(formatImportWriteError(second)).toBeDefined()
})

test("formatImportWriteError terminates on a chain longer than the depth cap", () => {
  let head: Record<string, unknown> = { cause: sqlError(new Error("FOREIGN KEY constraint failed")) }
  for (let i = 0; i < 40; i++) head = { cause: head }
  expect(formatImportWriteError(head)).toBeDefined()
})
// kilocode_change end
