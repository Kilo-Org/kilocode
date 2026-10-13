import type { APIEvent } from "@solidjs/start/server"
import { ZenData } from "@opencode/console-core/model.js"
import { i18n } from "~/i18n"
import { localeFromRequest } from "~/lib/language"
import { prepareRequestBody } from "./requestBody"
import { inferenceUnavailable, proxyInference } from "~/lib/inference-proxy"

// Every request is served by new inference; this only routes and rejects what it cannot route.
export async function handler(
  input: APIEvent,
  opts: {
    format: ZenData.Format
    modelList: "lite" | "full"
    parseApiKey: (headers: Headers) => string | undefined
    /** Reads the model from the URL for formats that do not send it in the body. */
    parseModel?: (url: string) => string
  },
) {
  const dict = i18n(localeFromRequest(input.request))
  const body = input.request.body
  if (!body) return error(400, "error", "Missing request body")
  const requestBody = opts.format === "google" ? undefined : await prepareRequestBody(body)
  const model = requestBody ? requestBody.model : (opts.parseModel?.(input.request.url) ?? "")
  const configured = model ? ZenData.list(opts.modelList).models[model] : undefined
  const entry = Array.isArray(configured) ? configured.find((entry) => entry.formatFilter === opts.format) : configured
  const cancel = () => void (requestBody ? requestBody.cancel() : body.cancel()).catch(() => {})

  if (model) {
    const response = await proxyInference(input.request, {
      provider: opts.modelList === "full" ? entry?.byokProvider : undefined,
      model:
        opts.modelList === "full"
          ? entry?.providers.find((provider) => provider.id === entry.byokProvider)?.model
          : undefined,
      // Keyless requests for free models go straight to new inference.
      anonymous: opts.modelList === "full" && entry?.allowAnonymous === true,
      body: (providerModel) => requestBody?.stream(providerModel ?? model, false) ?? body,
    }).catch(() => {
      cancel()
      return inferenceUnavailable()
    })
    if (response) return response
  }

  // Unrouted: unknown model, missing key, or a key without a migrated workspace.
  cancel()
  if (!configured) return error(401, "ModelError", dict["zen.api.error.modelNotSupported"].replace("{{model}}", model))
  if (!entry)
    return error(
      401,
      "ModelError",
      dict["zen.api.error.modelFormatNotSupported"].replace("{{model}}", model).replace("{{format}}", opts.format),
    )
  const key = opts.parseApiKey(input.request.headers)
  if (!key || key === "public") return error(401, "AuthError", dict["zen.api.error.missingApiKey"])
  return error(401, "AuthError", dict["zen.api.error.invalidApiKey"])
}

// Both top level "type" and "error.type" are used by the @ai-sdk/anthropic client to render the error message.
function error(status: number, type: string, message: string) {
  return new Response(JSON.stringify({ type: "error", error: { type, message } }), { status })
}
