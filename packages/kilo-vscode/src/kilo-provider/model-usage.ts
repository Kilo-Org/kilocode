const LIMIT = 200
export type ModelUsageMap = Record<string, { count: number; lastUsed: number }>
export type ModelUsageMessage =
  | { type: "recordModelUsage"; providerID: string; modelID: string }
  | { type: "requestModelUsage" }

function valid(value: unknown): value is { count: number; lastUsed: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const count = item.count
  const lastUsed = item.lastUsed
  return (
    typeof count === "number" &&
    Number.isFinite(count) &&
    count > 0 &&
    typeof lastUsed === "number" &&
    Number.isFinite(lastUsed)
  )
}

export function validateModelUsage(raw: unknown): ModelUsageMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const entries = Object.entries(raw as Record<string, unknown>).flatMap(([key, value]) =>
    valid(value) ? [[key, value] as const] : [],
  )
  return Object.fromEntries(
    entries
      .sort(([, a], [, b]) => b.lastUsed - a.lastUsed)
      .slice(0, LIMIT)
      .map(([key, value]) => [
        key,
        {
          count: Math.floor(value.count),
          lastUsed: value.lastUsed,
        },
      ]),
  )
}

export function recordModelUsage(raw: unknown, providerID: unknown, modelID: unknown, now = Date.now()): ModelUsageMap {
  if (typeof providerID !== "string" || !providerID || typeof modelID !== "string" || !modelID) {
    return validateModelUsage(raw)
  }
  const usage = validateModelUsage(raw)
  const key = `${providerID}/${modelID}`
  const current = usage[key] ?? { count: 0, lastUsed: 0 }
  usage[key] = { count: current.count + 1, lastUsed: now }
  return validateModelUsage(usage)
}

export async function handleModelUsageMessage(
  message: ModelUsageMessage,
  context:
    | { globalState: { get: (key: string) => unknown; update: (key: string, value: unknown) => Thenable<void> } }
    | undefined,
  post: (message: unknown) => void,
): Promise<void> {
  const current = context?.globalState.get("modelUsage")
  const usage =
    message.type === "recordModelUsage"
      ? recordModelUsage(current, message.providerID, message.modelID)
      : validateModelUsage(current)
  if (message.type === "recordModelUsage") await context?.globalState.update("modelUsage", usage)
  post({ type: "modelUsageLoaded", usage })
}
