import type { APIEvent } from "@solidjs/start/server"
import { buildOptionsResponse } from "../../util/modelsHandler"
import { inferenceUnavailable, proxyInference } from "~/lib/inference-proxy"

export async function OPTIONS(_input: APIEvent) {
  return buildOptionsResponse()
}

export async function GET(input: APIEvent) {
  const response = await proxyInference(input.request).catch(inferenceUnavailable)
  if (response) return response
  return Response.json({ type: "error", error: { type: "AuthError", message: "Invalid API key." } }, { status: 401 })
}
