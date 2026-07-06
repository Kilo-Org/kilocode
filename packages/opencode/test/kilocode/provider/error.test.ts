import { describe, expect, test } from "bun:test"
import { MessageV2 } from "@/session/message-v2"
import { ProviderID } from "@/provider/schema"

describe("provider stream errors", () => {
  test("normalizes empty rate-limit messages", () => {
    const body = {
      type: "error",
      sequence_number: 2,
      error: {
        type: "tokens",
        code: "rate_limit_exceeded",
        message: "",
        param: null,
      },
    }
    const result = MessageV2.fromError({ message: JSON.stringify(body) }, { providerID: ProviderID.make("openai") })

    expect(result).toStrictEqual({
      name: "APIError",
      data: {
        message: "Provider rate limit exceeded. Please try again shortly.",
        isRetryable: true,
        responseBody: JSON.stringify(body),
      },
    })
  })

  test("preserves provider rate-limit messages", () => {
    const body = {
      type: "error",
      error: {
        type: "tokens",
        code: "rate_limit_exceeded",
        message: "Try again in 30 seconds.",
      },
    }
    const result = MessageV2.fromError({ message: JSON.stringify(body) }, { providerID: ProviderID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(body.error.message)
    expect(result.data.isRetryable).toBe(true)
  })
})
