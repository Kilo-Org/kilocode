import { describe, expect, it } from "bun:test"
import { parseCloudMessageAcceptance, parseCloudMessageFailure } from "../../src/agent-manager/cloud-agent/message"

describe("parseCloudMessageAcceptance", () => {
  it("returns message IDs from durable admission and accepted delivery events", () => {
    const values = [
      { type: "cloud.message.queued", properties: { messageId: "msg_queued" } },
      { type: "cloud.message.sent", properties: { messageId: "msg_sent" } },
      { type: "cloud.message.completed", properties: { messageId: "msg_completed", accepted: true } },
      { type: "cloud.message.failed", properties: { messageId: "msg_failed", accepted: true } },
    ]

    expect(values.map(parseCloudMessageAcceptance)).toEqual(["msg_queued", "msg_sent", "msg_completed", "msg_failed"])
  })

  it("ignores pre-delivery failures and malformed events", () => {
    const values = [
      undefined,
      {},
      { type: "cloud.message.failed", properties: { messageId: "msg_failed", accepted: false } },
      { type: "cloud.message.queued", properties: { messageId: "" } },
      { type: "cloud.status", properties: { messageId: "msg_status" } },
    ]

    for (const value of values) expect(parseCloudMessageAcceptance(value)).toBeUndefined()
  })
})

describe("parseCloudMessageFailure", () => {
  it("parses and sanitizes pre-delivery failures", () => {
    for (const status of ["failed", "interrupted"] as const) {
      expect(
        parseCloudMessageFailure({
          type: "cloud.message.failed",
          properties: {
            sessionID: "ses_cloud",
            messageId: "msg_cloud",
            status,
            delivery: "queued",
            accepted: false,
            error: "secret",
          },
        }),
      ).toEqual({ sessionID: "ses_cloud", messageID: "msg_cloud", status })
    }
  })

  it("ignores accepted execution failures and malformed events", () => {
    const values = [
      undefined,
      null,
      {},
      { type: "cloud.message.sent", properties: { sessionID: "ses_cloud", messageId: "msg_cloud" } },
      {
        type: "cloud.message.failed",
        properties: {
          sessionID: "ses_cloud",
          messageId: "msg_cloud",
          status: "failed",
          delivery: "sent",
          accepted: true,
        },
      },
      {
        type: "cloud.message.failed",
        properties: {
          sessionID: "ses_cloud",
          messageId: "msg_cloud",
          status: "interrupted",
          delivery: "sent",
          accepted: false,
        },
      },
      {
        type: "cloud.message.failed",
        properties: {
          sessionID: 42,
          messageId: "msg_cloud",
          status: "failed",
          delivery: "queued",
          accepted: false,
        },
      },
      {
        type: "cloud.message.failed",
        properties: {
          sessionID: "ses_cloud",
          messageId: "",
          status: "failed",
          delivery: "queued",
          accepted: false,
        },
      },
      {
        type: "cloud.message.failed",
        properties: {
          sessionID: "ses_cloud",
          messageId: "msg_cloud",
          status: "unknown",
          delivery: "queued",
          accepted: false,
        },
      },
    ]

    for (const value of values) expect(parseCloudMessageFailure(value)).toBeUndefined()
  })
})
