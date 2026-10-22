import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { CloudSessionData } from "../../src/kilocode/server/httpapi/groups/kilo-gateway"

describe("cloud session HTTP schema", () => {
  test("preserves transcript fields needed by the VS Code preview", () => {
    const input = {
      info: {
        id: "ses_cloud",
        title: "Cloud transcript",
        slug: "cloud-transcript",
        time: { created: 1, updated: 2 },
      },
      messages: [
        {
          info: {
            id: "msg_user",
            sessionID: "ses_cloud",
            role: "user" as const,
            agent: "code",
            time: { created: 3 },
          },
          parts: [
            {
              id: "prt_text",
              sessionID: "ses_cloud",
              messageID: "msg_user",
              type: "text",
              text: "Show this cloud message",
            },
          ],
        },
      ],
    }

    expect(Schema.encodeUnknownSync(CloudSessionData)(input)).toEqual(input)
  })
})
