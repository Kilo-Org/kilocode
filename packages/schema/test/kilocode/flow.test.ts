import { expect, test } from "bun:test"
import { Schema } from "effect"
import { KiloFlowRpc } from "../../src/kilocode/flow.js"

test("encodes and decodes Flow health errors with and without an optional reason", () => {
  const decode = Schema.decodeUnknownSync(KiloFlowRpc.Health)
  const encode = Schema.encodeSync(KiloFlowRpc.Health)

  expect(decode({ status: "healthy" })).toEqual({ status: "healthy" })
  expect(
    decode({
      status: "error",
      message: "Flow directory /workspace no longer exists",
      reason: "directory-missing",
    }),
  ).toEqual({
    status: "error",
    message: "Flow directory /workspace no longer exists",
    reason: "directory-missing",
  })
  expect(encode({ status: "error", message: "Backing schedule missing", reason: undefined })).toEqual({
    status: "error",
    message: "Backing schedule missing",
  })
})
