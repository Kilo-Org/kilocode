import type { Accessor } from "solid-js"
import { createReviewComposer, type ReviewComposer } from "../diff-viewer/review-annotations"

export function createReviewComposers(project: Accessor<string | undefined>) {
  const values = new Map<string, ReviewComposer>()

  const get = (key: string) => {
    const current = values.get(key)
    if (current) return current
    const next = createReviewComposer()
    values.set(key, next)
    return next
  }

  const clear = (ctx: string | null) => {
    if (!ctx) return
    const prefix = `${project() ?? "single"}\0${ctx}`
    for (const key of values.keys()) {
      if (key === prefix || key.startsWith(`${prefix}#`)) values.delete(key)
    }
  }

  const drop = (key: string) => values.delete(key)

  const clearProject = (id: string) => {
    const prefix = `${id}\0`
    for (const key of values.keys()) {
      if (key.startsWith(prefix)) values.delete(key)
    }
  }

  const prune = (contexts: Set<string>) => {
    const prefix = `${project() ?? "single"}\0`
    for (const key of values.keys()) {
      if (!key.startsWith(prefix)) continue
      const ctx = key.slice(prefix.length).split("#", 1)[0]
      if (ctx !== "local" && !contexts.has(ctx)) values.delete(key)
    }
  }

  return { get, clear, drop, clearProject, prune }
}
