import { describe, test, expect, spyOn } from "bun:test"
import { Client } from "../client.js"
import { Telemetry } from "../telemetry.js"

const timeout = "Timeout while shutting down PostHog. Some events may not have been sent."

describe("Telemetry.shutdown timeout (#9788)", () => {
  test("passes timeoutMs through to PostHog.shutdown and skips unbounded explicit flush()", async () => {
    // Reproduces the CLI exit hang reported in #9788: when the PostHog endpoint
    // is unreachable (offline, firewall, DNS adblock resolving the host to
    // 0.0.0.0), an explicit flush() call before shutdown retries 3x with 3s
    // gaps plus 10s per attempt before throwing, blocking process.exit on
    // short-lived commands like `kilo --help`. The fix drops the explicit
    // flush() (PostHog.shutdown drains the queue itself) and threads a caller-
    // supplied timeoutMs through to PostHog.shutdown.
    Client.init()
    const client = Client.getClient()!
    // Scope the failure to this instance: module mocks leak into other test
    // files and make the conda test's shutdown reject depending on load order.
    const flush = spyOn(client, "flush").mockRejectedValue(new Error("flush should not be called"))
    const shutdown = spyOn(client, "shutdown").mockRejectedValue(timeout)

    try {
      await expect(Telemetry.shutdown(50)).rejects.toBe(timeout)

      expect(flush).not.toHaveBeenCalled()
      expect(shutdown).toHaveBeenCalledTimes(1)
      expect(shutdown).toHaveBeenCalledWith(50)
      expect(Client.getClient()).toBeNull()
    } finally {
      flush.mockRestore()
      shutdown.mockRestore()
      await client.shutdown()
    }
  })

  test("a new client shuts down normally after the timeout test", async () => {
    Client.init()
    const client = Client.getClient()
    expect(client).not.toBeNull()
    await Telemetry.shutdown()
    expect(Client.getClient()).toBeNull()
  })
})
