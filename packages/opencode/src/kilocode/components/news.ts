import type { KilocodeNotification } from "@kilocode/kilo-gateway"

export namespace News {
  export const key = "news_read_ids"

  function ids(value: unknown) {
    if (!Array.isArray(value)) return []
    return value.filter((id): id is string => typeof id === "string")
  }

  export function unread(items: KilocodeNotification[], value: unknown) {
    const read = new Set(ids(value))
    return items.filter((item) => !read.has(item.id))
  }

  export function read(items: KilocodeNotification[], value: unknown) {
    return [...new Set([...ids(value), ...items.map((item) => item.id)])]
  }
}
