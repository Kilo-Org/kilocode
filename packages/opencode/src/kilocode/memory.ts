import { Instance } from "../project/instance"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"

export namespace Memory {
  const log = Log.create({ service: "memory" })

  export type Info = {
    key: string
    content: string
    time: {
      created: number
      updated: number
    }
  }

  function dir() {
    return ["kilocode", "memory", Instance.project.id]
  }

  function file(key: string) {
    return [...dir(), encodeURIComponent(key)]
  }

  export async function set(input: { key: string; content: string }) {
    const now = Date.now()
    const prev = await Storage.read<Info>(file(input.key)).catch(() => undefined)
    const next: Info = {
      key: input.key,
      content: input.content,
      time: {
        created: prev?.time.created ?? now,
        updated: now,
      },
    }
    await Storage.write(file(input.key), next)
    return next
  }

  export async function list(input: { limit?: number } = {}) {
    const keys = await Storage.list(dir())
    const items = await Promise.all(keys.map((key) => Storage.read<Info>(key)))
    return items.toSorted((a, b) => b.time.updated - a.time.updated).slice(0, input.limit ?? 50)
  }

  export async function remove(input: { key: string }) {
    await Storage.remove(file(input.key))
  }

  export async function prompt() {
    const items = await list({ limit: 20 }).catch((err) => {
      log.error("failed to load persistent memory", { err })
      return []
    })
    if (!items.length) return ""
    return [
      "Persistent project memory:",
      ...items.map((item) => `- ${item.key}: ${item.content}`),
    ].join("\n")
  }
}
