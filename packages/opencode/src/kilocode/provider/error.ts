import { isRecord } from "@/util/record"

export function responseFailed(input: unknown) {
  if (!isRecord(input)) return
  if (input.type !== "response.failed") return
  if (!isRecord(input.response)) return
  if (!isRecord(input.response.error)) return

  const message = input.response.error.message
  if (typeof message !== "string" || !message.trim()) return
  const code = input.response.error.code
  return {
    type: "api_error" as const,
    message,
    isRetryable: code === "server_error" || code === "server_is_overloaded",
    responseBody: JSON.stringify(input),
  }
}
