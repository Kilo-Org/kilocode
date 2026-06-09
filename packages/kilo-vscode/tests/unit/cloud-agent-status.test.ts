import { describe, expect, it } from "bun:test"
import { parseCloudStatus } from "../../src/agent-manager/cloud-agent/status"

describe("parseCloudStatus", () => {
  it("parses and sanitizes valid cloud status types and steps", () => {
    const types = ["preparing", "ready", "finalizing", "error"]
    const steps = [
      "disk_check",
      "workspace_setup",
      "cloning",
      "branch",
      "devcontainer_setup",
      "setup_commands",
      "kilo_server",
      "kilo_session",
      "ready",
      "failed",
    ]

    for (const [index, step] of steps.entries()) {
      const type = types[index % types.length]
      expect(
        parseCloudStatus({
          id: "evt_status",
          type: "cloud.status",
          properties: { sessionID: "ses_cloud", cloudStatus: { type, step, detail: "secret" } },
        }),
      ).toEqual({ sessionID: "ses_cloud", cloudStatus: { type, step } })
    }
  })

  it("preserves valid status while omitting unknown or malformed steps", () => {
    for (const step of ["unknown", 42, null, {}, []]) {
      expect(
        parseCloudStatus({
          type: "cloud.status",
          properties: { sessionID: "ses_cloud", cloudStatus: { type: "ready", step } },
        }),
      ).toEqual({ sessionID: "ses_cloud", cloudStatus: { type: "ready" } })
    }
  })

  it("ignores malformed events and statuses", () => {
    const values = [
      undefined,
      null,
      [],
      {},
      { type: "session.status", properties: { sessionID: "ses_cloud", cloudStatus: { type: "ready" } } },
      { type: "cloud.status" },
      { type: "cloud.status", properties: null },
      { type: "cloud.status", properties: { sessionID: 42, cloudStatus: { type: "ready" } } },
      { type: "cloud.status", properties: { sessionID: "ses_cloud" } },
      { type: "cloud.status", properties: { sessionID: "ses_cloud", cloudStatus: null } },
      { type: "cloud.status", properties: { sessionID: "ses_cloud", cloudStatus: { type: "unknown" } } },
    ]

    for (const value of values) expect(parseCloudStatus(value)).toBeUndefined()
  })
})
