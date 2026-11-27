import type { Schema } from "effect"

export const object = (value: Schema.Json | undefined): value is { [key: string]: Schema.Json } =>
  value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)

/** Assemble only a complete assistant message at one pinned snapshot position. */
export function reconstructMessage(
  value: Schema.Json,
  parts: readonly Schema.Json[],
  position: number,
): { complete: false } | { complete: true; value: Schema.Json } {
  if (!object(value) || !object(value.message)) return { complete: false }
  if (value.parts === undefined) return { complete: true, value }
  if (!object(value.parts) || value.message.type !== "assistant" || typeof value.message.id !== "string")
    return { complete: false }
  const through = value.parts.through
  if (!natural(through) || !natural(position) || position < through) return { complete: false }
  const messageID = value.message.id
  const matching = parts.filter((part) => object(part) && part.messageID === messageID)
  if (!natural(value.parts.count) || !value.parts.count || matching.length !== value.parts.count)
    return { complete: false }
  const ordered: { ordinal: number; part: Schema.Json }[] = []
  const ordinals = new Set<number>()
  for (const part of matching) {
    if (!completePart(part, through) || ordinals.has(part.ordinal)) return { complete: false }
    ordinals.add(part.ordinal)
    ordered.push({ ordinal: part.ordinal, part: part.part })
  }
  ordered.sort((a, b) => a.ordinal - b.ordinal)
  const { parts: _, ...envelope } = value
  // Inline content left on a split row follows its part rows, as the native reader returns it.
  const inline = Array.isArray(value.message.content) ? value.message.content : []
  return {
    complete: true,
    value: { ...envelope, message: { ...value.message, content: [...ordered.map((part) => part.part), ...inline] } },
  }
}

function natural(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function completePart(part: Schema.Json, through: number): part is { ordinal: number; part: Schema.Json } {
  return (
    object(part) &&
    natural(part.ordinal) &&
    natural(part.position) &&
    part.position <= through &&
    part.deferred !== true &&
    object(part.part)
  )
}
