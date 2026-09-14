import { expect, test } from "bun:test"
import { MemoryRedact } from "@kilocode/kilo-memory/redact"

test("document redaction preserves original line and page separators", () => {
  const input =
    "\n\nintro\r\n-----BEGIN PRIVATE KEY-----\nPRIVATE_MATERIAL\fMORE_MATERIAL\n-----END PRIVATE KEY-----\nend"
  const value = MemoryRedact.lines(input)
  expect(value.match(/[\r\n\f]/g)).toEqual(input.match(/[\r\n\f]/g))
  expect(value).not.toContain("PRIVATE_MATERIAL")
  expect(value).not.toContain("MORE_MATERIAL")
  expect(value).toContain("[redacted]")
})

test("redacts full credentials before callers select a character window", () => {
  const token = "sk-" + "a1".repeat(18)
  const input = "x".repeat(2489) + " " + token
  expect(MemoryRedact.lines(input).slice(0, 2500)).not.toContain("sk-")
  expect(MemoryRedact.lines(input)).not.toContain(token)
})

test("masks signed URL values while leaving ordinary source parameters", () => {
  const value = MemoryRedact.lines("https://storage.example.com/a?X-Goog-Signature=PRIVATE_VALUE&page=4")
  expect(value).not.toContain("PRIVATE_VALUE")
  expect(value).toContain("page=4")
})

test("long identifiers and malformed JWT-like runs do not cause quadratic scanning", () => {
  const input = "x".repeat(1_000_000)
  expect(MemoryRedact.lines(input)).toBe(input)
  const jwt = "eyJ".repeat(100_000)
  expect(MemoryRedact.lines(jwt)).toBe(jwt)
  const dotted = "word.".repeat(100_000)
  expect(MemoryRedact.lines(dotted)).toBe(dotted)
  const query = "?".repeat(100_000)
  expect(MemoryRedact.lines(query)).toBe(query)
}, 2000)
