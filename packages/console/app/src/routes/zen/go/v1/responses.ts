import type { APIEvent } from "@solidjs/start/server"
import { proxyInference } from "~/lib/inference-proxy"

export function POST(input: APIEvent) {
  return proxyInference(input.request)
}
