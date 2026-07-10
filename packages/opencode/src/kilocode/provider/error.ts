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
    code: typeof code === "string" ? code : undefined,
    message,
  }
}
