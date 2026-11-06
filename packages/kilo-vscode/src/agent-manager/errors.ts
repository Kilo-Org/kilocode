/** Extract a human-readable error message from an unknown error value. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (!error || typeof error !== "object") return String(error)

  const obj = error as Record<string, unknown>
  if (typeof obj.message === "string") return obj.message
  if (typeof obj.error === "string") return obj.error

  if (obj.error && typeof obj.error === "object") {
    const nested = (obj.error as Record<string, unknown>).message
    if (typeof nested === "string") return nested
  }

  if (obj.data && typeof obj.data === "object") {
    const fromData = messageFromData(obj.data as Record<string, unknown>)
    if (fromData) return fromData
  }

  const fromErrors = firstMessage(obj.errors)
  if (fromErrors) return fromErrors

  return safeStringify(error) ?? String(error)
}

function firstMessage(arr: unknown): string | undefined {
  if (!Array.isArray(arr) || arr.length === 0) return undefined
  const first = arr[0]
  if (typeof first === "string") return first
  if (first && typeof first === "object") {
    const msg = (first as Record<string, unknown>).message
    if (typeof msg === "string") return msg
  }
  return undefined
}

function messageFromData(data: Record<string, unknown>): string | undefined {
  if (typeof data.message === "string") return data.message
  const fromIssues = firstMessage(data.issues)
  if (fromIssues) return fromIssues
  return firstMessage(data.error)
}

function safeStringify(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(value)
    if (json !== "{}" && json.length < 500) return json
  } catch {
    return undefined
  }
  return undefined
}
