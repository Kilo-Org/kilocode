import { errorCode } from "@/kilocode/session-hosting/response"
import { expect, test } from "bun:test"

test.each([
  { error: "KILO_SESSION_NOT_FOUND" },
  { code: "KILO_SESSION_NOT_FOUND" },
  { error: { code: "KILO_SESSION_NOT_FOUND" } },
  { error: { json: { code: "KILO_SESSION_NOT_FOUND" } } },
  { error: { message: "not found", data: { code: "KILO_SESSION_NOT_FOUND" } } },
  { error: { json: { message: "not found", data: { code: "KILO_SESSION_NOT_FOUND" } } } },
])("extracts error codes from supported response envelopes %j", (body) => {
  expect(errorCode(body)).toBe("KILO_SESSION_NOT_FOUND")
})

test.each([
  { error: { message: "KILO_INTERACTION_UNAVAILABLE" } },
  { error: { json: { message: "KILO_INTERACTION_UNAVAILABLE" } } },
  { error: { message: "KILO_INTERACTION_UNAVAILABLE", data: { code: "CONFLICT" } } },
  { error: { json: { message: "KILO_INTERACTION_UNAVAILABLE", data: { code: "CONFLICT" } } } },
])("retains message-only provider failure codes %j", (body) => {
  expect(errorCode(body)).toBe("KILO_INTERACTION_UNAVAILABLE")
})

test.each([undefined, null, "missing", 404, {}, { error: null }, { error: { code: 404 } }])(
  "ignores responses without string error codes %j",
  (body) => {
    expect(errorCode(body)).toBeUndefined()
  },
)
