import { expect, test } from "bun:test"
import { Schema } from "effect"
import { SessionID } from "../../src/session-id"
import { PermissionV1 } from "../../src/v1/permission"

test("managed approval is optional on V1 requests and events but never caller-supplied", () => {
  const request = {
    id: PermissionV1.ID.make("per_test"),
    sessionID: SessionID.make("ses_test"),
    permission: "edit",
    patterns: ["file.txt"],
    metadata: {},
    always: [],
  }
  const managed = { ...request, managed: { revision: 7 } }

  expect(Schema.encodeSync(PermissionV1.Request)({ ...request, managed: undefined })).toEqual(request)
  expect(Schema.encodeSync(PermissionV1.Request)(managed)).toEqual(managed)
  expect(Schema.encodeSync(PermissionV1.Event.Asked.data)(managed)).toEqual(managed)
  expect(Schema.decodeUnknownSync(PermissionV1.AskInput)({ ...managed, ruleset: [] })).not.toHaveProperty("managed")
  expect(() => Schema.decodeUnknownSync(PermissionV1.Request)({ ...request, managed: { revision: "NaN" } })).toThrow()
})

test("managed policy state exposes diagnostics without credentials or policy rules", () => {
  const decode = Schema.decodeUnknownSync(PermissionV1.ManagedState)
  expect(decode({ status: "personal" })).toEqual({ status: "personal" })
  for (const status of ["active", "disabled"] as const) {
    const state = { status, organization: "test", revision: 7, unrestricted: false }
    expect(decode({ ...state, rules: [], token: "test-secret" })).toEqual(state)
  }
  for (const reason of ["unavailable", "unauthorized", "invalid", "update-required", "client-denied"] as const) {
    const state = { status: "unavailable", organization: "test", reason } as const
    expect(decode(state)).toEqual(state)
  }
  expect(() => decode({ status: "unavailable", organization: "test", reason: "unknown" })).toThrow()
})
