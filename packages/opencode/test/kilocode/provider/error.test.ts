import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { MessageV2 } from "@/session/message-v2"
import { ProviderV2 } from "@opencode-ai/core/provider"

const googleAuthError =
  "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential. See https://developers.google.com/identity/sign-in/web/devconsole-project."

function apiError(message = googleAuthError, reason?: string) {
  return new APICallError({
    message,
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent",
    requestBodyValues: {},
    statusCode: 401,
    responseHeaders: { "content-type": "application/json" },
    responseBody: JSON.stringify({
      error: {
        code: 401,
        message,
        status: "UNAUTHENTICATED",
        ...(reason
          ? {
              details: [
                {
                  "@type": "type.googleapis.com/google.rpc.ErrorInfo",
                  reason,
                  domain: "googleapis.com",
                  metadata: { service: "generativelanguage.googleapis.com" },
                },
              ],
            }
          : {}),
      },
    }),
    isRetryable: false,
  })
}

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
    const result = MessageV2.fromError({ message: JSON.stringify(body) }, { providerID: ProviderV2.ID.make("openai") })

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
    const result = MessageV2.fromError({ message: JSON.stringify(body) }, { providerID: ProviderV2.ID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(body.error.message)
    expect(result.data.isRetryable).toBe(true)
  })
})

describe("responses api terminal frames", () => {
  test("surfaces the provider message from a response.failed frame", () => {
    const payload = {
      type: "response.failed",
      sequence_number: 8,
      response: {
        error: {
          code: "rate_limit_exceeded",
          message:
            "openai/gpt-5.6-terra-pro is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations",
        },
        incomplete_details: null,
        service_tier: "auto",
      },
    }
    const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(payload.response.error.message)
    expect(result.data.isRetryable).toBe(true)
    expect(result.data.responseBody).toBe(JSON.stringify(payload))
  })

  test("unwraps bare chat-completions error objects", () => {
    const payload = { code: "rate_limit_exceeded", message: "Try again in 30 seconds." }
    const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(payload.message)
    expect(result.data.isRetryable).toBe(true)
  })

  test("unwraps envelope-less error wrappers", () => {
    const payload = { error: { code: "rate_limit_exceeded", message: "Try again in 30 seconds.", type: "tokens" } }
    const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(payload.error.message)
    expect(result.data.isRetryable).toBe(true)
  })

  test("prefers a nested error record over bare top-level fields", () => {
    const payload = {
      code: 429,
      message: "gateway wrapper",
      error: { code: "rate_limit_exceeded", message: "inner provider detail" },
    }
    const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(payload.error.message)
    expect(result.data.isRetryable).toBe(true)
  })

  test("surfaces messages for unlisted error codes", () => {
    const payload = {
      type: "response.failed",
      response: { error: { code: "model_not_found", message: "no such model" }, incomplete_details: null },
    }
    const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe("no such model")
    expect(result.data.isRetryable).toBe(false)
  })

  test("marks numeric 429 and 5xx error codes retryable", () => {
    for (const payload of [
      { code: 429, message: "too many requests" },
      { code: 503, message: "service unavailable" },
    ]) {
      const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

      expect(MessageV2.APIError.isInstance(result)).toBe(true)
      if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
      expect(result.data.message).toBe(payload.message)
      expect(result.data.isRetryable).toBe(true)
    }
  })

  test("retries exhausted and anthropic rate-limit shapes like the old heuristics", () => {
    const exhausted = { code: "resource_exhausted", message: "quota exceeded for the day" }
    const anthropic = {
      type: "error",
      error: { type: "rate_limit_error", message: "request has exceeded your per-minute rate limit" },
    }
    for (const payload of [exhausted, anthropic]) {
      const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

      expect(MessageV2.APIError.isInstance(result)).toBe(true)
      if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
      expect(result.data.isRetryable).toBe(true)
    }
  })

  test("marks numeric-string error codes retryable", () => {
    const payload = { code: "429", message: "slow down" }
    const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.isRetryable).toBe(true)
  })

  test("normalizes error objects with explicit null fields", () => {
    const payload = {
      error: {
        message: "The server had an error while processing your request",
        type: "server_error",
        param: null,
        code: null,
      },
    }
    const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(payload.error.message)
    expect(result.data.isRetryable).toBe(true)
  })

  test("normalizes response.failed frames with a null error code", () => {
    const payload = {
      type: "response.failed",
      response: { error: { code: null, message: "mid-stream failure" }, incomplete_details: null },
    }
    const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe("mid-stream failure")
    expect(result.data.isRetryable).toBe(false)
  })

  test("does not retry terminal errors that merely mention availability", () => {
    const payload = { code: "invalid_request", message: "The model is unavailable in your region" }
    const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.isRetryable).toBe(false)
  })

  test("retries hyphenated rate-limit prose", () => {
    const payload = {
      code: "upstream_error",
      message: "openai/gpt-5.6-terra-pro is temporarily rate-limited upstream. Please retry shortly.",
    }
    const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.isRetryable).toBe(true)
  })

  test("ignores response.failed frames without an error payload", () => {
    const payload = { type: "response.failed", response: { error: null, incomplete_details: null } }
    const result = MessageV2.fromError(payload, { providerID: ProviderV2.ID.make("openai") })

    expect(MessageV2.APIError.isInstance(result)).toBe(false)
  })
})

describe("Google Gemini authentication errors", () => {
  test("explains how to troubleshoot the rejected API key", () => {
    const error = apiError(googleAuthError, "ACCESS_TOKEN_TYPE_UNSUPPORTED")
    const result = MessageV2.fromError(error, { providerID: ProviderV2.ID.make("google") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(
      "Google Gemini rejected this API key. Check its type and status in Google AI Studio. Replace a Standard key with a new auth key; if it is already an auth key, check its Gemini API access or create a replacement. Restricted Standard keys work only until September 2026. See https://kilo.ai/docs/ai-providers/gemini.",
    )
    expect(result.data.statusCode).toBe(401)
    expect(result.data.isRetryable).toBe(false)
    expect(result.data.responseBody).toBe(error.responseBody)
  })

  test("preserves other Google authentication errors", () => {
    const error = apiError("API key not valid. Please pass a valid API key.")
    const result = MessageV2.fromError(error, { providerID: ProviderV2.ID.make("google") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(error.message)
  })

  test("does not rewrite Google Vertex errors", () => {
    const error = apiError()
    const result = MessageV2.fromError(error, { providerID: ProviderV2.ID.make("google-vertex") })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(error.message)
  })
})
