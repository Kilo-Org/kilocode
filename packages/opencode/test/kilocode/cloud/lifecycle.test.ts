import { describe, expect, test } from "bun:test"
import {
  GetMessageResultOutputSchema,
  projectStatus,
  resultExitCode,
  type MessageResult,
} from "../../../src/kilocode/cloud/contracts"

const SESSION = "agent_12345678-1234-1234-1234-123456789abc"
const MESSAGE = "msg_018f1e2d3c4bAbCdEfGhIjKlMn"

describe("Cloud Agent lifecycle projection", () => {
  test("status omits assistant content", () => {
    const result = GetMessageResultOutputSchema.parse({
      cloudAgentSessionId: SESSION,
      messageId: MESSAGE,
      status: "completed",
      createdAt: 1,
      terminalAt: 2,
      assistant: { messageId: "assistant_1", text: "private response" },
    })

    const status = projectStatus(result)
    expect(status.status).toBe("completed")
    expect(status).not.toHaveProperty("assistant")
  })

  test("result status maps to documented lifecycle exits", () => {
    const cases: Array<[MessageResult["status"], 0 | 2 | 3 | 4]> = [
      ["completed", 0],
      ["queued", 2],
      ["running", 2],
      ["failed", 3],
      ["interrupted", 4],
    ]

    for (const [status, exit] of cases) expect(resultExitCode(status)).toBe(exit)
  })
})
