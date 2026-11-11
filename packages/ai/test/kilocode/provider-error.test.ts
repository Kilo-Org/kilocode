import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { isContextOverflow } from "../../src/effect.js"
import { classifyProviderFailure } from "../../src/provider-error.js"
import { RequestExecutor } from "../../src/route.js"
import { it } from "../lib/effect.js"
import { fixedResponse } from "../lib/http.js"

// BytePlus Ark rejects an over-long prompt with this message, which no upstream overflow pattern matched.
const ARK_OVERFLOW = "Input exceeds the context limit (1048568 tokens). Please shorten the input."

describe("Kilo provider overflow classification", () => {
  it.effect("classifies a BytePlus Ark context limit rejection as context overflow", () =>
    Effect.gen(function* () {
      expect(isContextOverflow(ARK_OVERFLOW)).toBe(true)
      expect(classifyProviderFailure({ message: ARK_OVERFLOW, status: 400 })).toMatchObject({
        _tag: "InvalidRequest",
        classification: "context-overflow",
      })

      const executor = yield* RequestExecutor.Service
      const error = yield* executor
        .execute(HttpClientRequest.post("https://ark.test/api/v3/chat/completions"))
        .pipe(Effect.flip)
      expect(error.reason).toMatchObject({ _tag: "InvalidRequest", classification: "context-overflow" })
    }).pipe(
      Effect.provide(
        fixedResponse(
          JSON.stringify({ error: { code: "InvalidParameter", message: ARK_OVERFLOW, type: "BadRequest" } }),
          {
            status: 400,
          },
        ),
      ),
    ),
  )

  it.effect("keeps a throttled Ark response retryable", () =>
    Effect.sync(() =>
      expect(classifyProviderFailure({ message: ARK_OVERFLOW, status: 429 })).toMatchObject({ _tag: "RateLimit" }),
    ),
  )
})
