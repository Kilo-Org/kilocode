import { describe, expect, test } from "bun:test"
import { createOpenAI } from "@ai-sdk/openai"
import { streamText } from "ai"
import { MessageV2 } from "@/session/message-v2"
import { ProviderID } from "@/provider/schema"

describe("provider stream errors", () => {
  test("receives response.failed details from the OpenAI provider", async () => {
    const body = {
      type: "response.failed",
      sequence_number: 1,
      response: {
        error: {
          code: "cyber_policy",
          message: "This content was flagged for possible cybersecurity risk.",
        },
        incomplete_details: null,
        usage: null,
        service_tier: null,
      },
    }
    const fetch = Object.assign(
      async () =>
        new Response(`data: ${JSON.stringify(body)}\n\ndata: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
      { preconnect() {} },
    )
    const openai = createOpenAI({
      apiKey: "test",
      fetch,
    })
    const stream = streamText({
      model: openai.responses("gpt-5"),
      prompt: "hello",
      maxRetries: 0,
      onError() {},
    })
    const error = await (async () => {
      for await (const part of stream.fullStream) {
        if (part.type === "error") return part.error
      }
    })()

    expect(error).toBeDefined()
    const result = MessageV2.fromError(error, { providerID: ProviderID.make("openai") })
    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(body.response.error.message)
  })

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

  test("surfaces Responses API response.failed messages", () => {
    const body = {
      type: "response.failed",
      response: {
        id: "resp_failed",
        status: "failed",
        error: {
          code: "cyber_policy",
          message:
            "This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request.",
        },
      },
    }
    const result = MessageV2.fromError(body, { providerID: ProviderID.make("openai") })

    expect(result).toStrictEqual({
      name: "APIError",
      data: {
        message: body.response.error.message,
        isRetryable: false,
        responseBody: JSON.stringify(body),
      },
    })
  })

  test("marks Responses API server failures as retryable", () => {
    const body = {
      type: "response.failed",
      response: {
        error: {
          code: "server_error",
          message: "The provider failed while processing the response.",
        },
      },
    }
    const result = MessageV2.fromError(body, { providerID: ProviderID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(body.response.error.message)
    expect(result.data.isRetryable).toBe(true)
  })
})
