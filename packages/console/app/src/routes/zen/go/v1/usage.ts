import type { APIEvent } from "@solidjs/start/server"
import { proxyInference } from "~/lib/inference-proxy"

export function GET(input: APIEvent) {
  return proxyInference(input.request)
}
