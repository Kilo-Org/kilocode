import { Effect, Option, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { explainBriefly, ResponseLensError, ResponseLensPayload } from "@/kilocode/response-lens"
import { ResponseLensFailedError } from "../groups/response-lens"

export const responseLensHandlers = HttpApiBuilder.group(InstanceHttpApi, "response-lens", (handlers) =>
  handlers.handleRaw("explain", () =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      // The framework's automatic JSON decoder currently turns malformed JSON
      // into a defect. Keep this endpoint's parsing typed and its errors private.
      const input = yield* request.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ResponseLensPayload)),
        Effect.option,
      )
      if (Option.isNone(input))
        return HttpServerResponse.jsonUnsafe(
          {
            name: "BadRequest",
            data: { message: "Invalid Response Lens request. Check the JSON, selection, context, level, and model." },
          },
          { status: 400 },
        )
      const signal = request.source instanceof Request ? request.source.signal : undefined
      return yield* Effect.tryPromise({
        try: (interrupted) => explainBriefly(input.value, AbortSignal.any([interrupted, ...(signal ? [signal] : [])])),
        catch: (error) =>
          new ResponseLensFailedError({
            message:
              error instanceof ResponseLensError
                ? error.message
                : error instanceof DOMException && error.name === "TimeoutError"
                  ? "The explanation timed out. Try again or choose another model."
                  : error instanceof DOMException && error.name === "AbortError"
                    ? "Explanation canceled."
                    : "The selected model could not produce an explanation. Check its availability and authentication, then try again.",
          }),
      })
    }),
  ),
)
