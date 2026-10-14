import type { APIEvent } from "@solidjs/start/server"
import { inferenceUnavailable, proxyInference } from "~/lib/inference-proxy"

export async function GET(input: APIEvent) {
  const response = await proxyInference(input.request).catch(inferenceUnavailable)
  if (response) return response
  return Response.json({ type: "error", error: { type: "AuthError", message: "Unauthorized" } }, { status: 401 })
}
