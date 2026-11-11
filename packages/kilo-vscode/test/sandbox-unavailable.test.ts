// A server build without the sandbox plugin answers `rpc.unavailable` for `support` and `status`. The composer must
// treat that as an unsupported server instead of reporting the optional feature as a failure on every session view.
import { describe, expect, test } from "bun:test"
import { failureHandling } from "../webview-ui/src/v2/sandbox-status"

describe("sandbox failureHandling", () => {
  test("treats a server without the plugin as unsupported", () => {
    expect(failureHandling({ type: "rpc.unavailable", message: "RPC is unavailable: kilocode.sandbox" })).toBe(
      "unsupported",
    )
  })

  test("retries a created session that is not on the server yet", () => {
    expect(failureHandling({ type: "not_found", message: "Unknown session" })).toBe("retry")
  })

  test("reports every other failure", () => {
    expect(failureHandling({ type: "rpc.internal", message: "RPC call failed" })).toBe("report")
    expect(failureHandling(new Error("network unavailable"))).toBe("report")
    expect(failureHandling(undefined)).toBe("report")
  })
})
