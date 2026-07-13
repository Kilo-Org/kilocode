import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { MessageV2 } from "@/session/message-v2"
import { ProviderID } from "@/provider/schema"

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

describe("Google Gemini authentication errors", () => {
  test("explains how to troubleshoot the rejected API key", () => {
    const error = apiError(googleAuthError, "ACCESS_TOKEN_TYPE_UNSUPPORTED")
    const result = MessageV2.fromError(error, { providerID: ProviderID.google })

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
    const result = MessageV2.fromError(error, { providerID: ProviderID.google })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(error.message)
  })

  test("does not rewrite Google Vertex errors", () => {
    const error = apiError()
    const result = MessageV2.fromError(error, { providerID: ProviderID.googleVertex })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    if (!MessageV2.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.message).toBe(error.message)
  })
})
