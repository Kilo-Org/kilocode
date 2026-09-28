import { createHash } from "node:crypto"
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

interface Message {
  event: string
  distinct_id: string
  properties: { $set?: Record<string, unknown>; alias?: string }
}

function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value) ?? "null")
    .digest("hex")
}

function entry(message: Message) {
  if (message.event !== "$identify" && message.event !== "$create_alias") return null
  return {
    key: digest([message.event, message.distinct_id, message.properties.alias]),
    value: digest(message.event === "$identify" ? message.properties.$set : message.properties.alias),
  }
}

// Only identity events are deduplicated. Activity still uses Identity.getDistinctId().
// Files contain hashes, never emails, tokens, or person properties.
export class Delivery {
  private pending = new Map<string, string>()

  constructor(private dir: string) {}

  accept(message: Message) {
    const item = entry(message)
    if (!item) return true
    if (this.pending.has(item.key)) {
      if (this.pending.get(item.key) === item.value) return false
    } else if (this.dir) {
      try {
        if (readFileSync(this.file(item.key), "utf8") === item.value) return false
      } catch {
        // Missing, unreadable, or corrupt caches must never prevent identification.
      }
    }
    this.pending.set(item.key, item.value)
    return true
  }

  retry() {
    this.pending.clear()
  }

  confirm(messages: Message[]) {
    for (const message of messages) {
      const item = entry(message)
      if (!item) continue
      if (!this.dir) continue
      const file = this.file(item.key)
      const tmp = `${file}.${process.pid}.tmp`
      try {
        // The SDK emits flush only after a successful HTTP upload. Commit before
        // shutdown returns; an interrupted/failed upload remains retryable.
        writeFileSync(tmp, item.value, { mode: 0o600 })
        renameSync(tmp, file)
      } catch (err) {
        if (process.env.KILO_PRINT_LOGS) console.warn("telemetry delivery cache write failed", err)
      } finally {
        try {
          rmSync(tmp, { force: true })
        } catch (err) {
          if (process.env.KILO_PRINT_LOGS) console.warn("telemetry delivery cache cleanup failed", err)
        }
      }
    }
  }

  private file(key: string) {
    return path.join(this.dir, `telemetry-delivery-${key}`)
  }
}
