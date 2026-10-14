import type { APIEvent } from "@solidjs/start/server"
import { handler } from "~/routes/zen/util/handler"

export function POST(input: APIEvent) {
  return handler(input, {
    format: "google",
    modelList: "full",
    parseApiKey: (headers: Headers) => headers.get("x-goog-api-key") ?? undefined,
    // ie. url: https://opencode.ai/zen/v1/models/gemini-3-pro:streamGenerateContent?alt=sse
    parseModel: (url: string) => url.split("/").pop()?.split(":")?.[0] ?? "",
  })
}
