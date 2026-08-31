import { zeroID } from "@opencode-ai/core/kilocode/zero-id"
import { imageMime } from "../diff/shared/image"
import type { Batch, Meta } from "./local-diff-batch"
import type { WorktreeDiffEntry } from "./types"

type Value = WorktreeDiffEntry | null

type Loader = {
  summary: (
    dir: string,
    base: string,
  ) => Promise<{ anc: string; metas: Meta[]; entries: WorktreeDiffEntry[] } | undefined>
  file: (dir: string, base: string, path: string, signal?: AbortSignal) => Promise<Value>
  detail: (dir: string, anc: string, meta: Meta, signal?: AbortSignal) => Promise<WorktreeDiffEntry>
  batch: (dir: string, anc: string, metas: Meta[]) => Promise<Batch>
  log?: (...args: unknown[]) => void
}

type Call = { active: boolean; signal?: AbortSignal }
type Item = {
  id: string
  scope: string
  queue: string
  dir: string
  base: string
  anc: string
  meta: Meta
  calls: Set<Call>
  started: boolean
  work: Promise<Value>
  resolve: (value: Value) => void
  reject: (error: unknown) => void
}

const MAX_BATCH_FILES = 16

export function createDiffCache(load: Loader) {
  const states = new Map<string, { anc: string; metas: Map<string, Meta> }>()
  const generations = new Map<string, number>()
  const details = new Map<string, { value: WorktreeDiffEntry; bytes: number }>()
  const pending = new Map<string, { work: Promise<Value>; item?: Item }>()
  const queues = new Map<string, Map<string, Item>>()
  let bytes = 0

  const remember = (id: string, value: WorktreeDiffEntry) => {
    const size = [value.before, value.after, value.patch, value.image?.before?.data, value.image?.after?.data].reduce(
      (sum, value) => sum + Buffer.byteLength(value ?? ""),
      0,
    )
    bytes -= details.get(id)?.bytes ?? 0
    details.delete(id)
    details.set(id, { value, bytes: size })
    bytes += size
    while (details.size > 128 || bytes > 64 * 1024 * 1024) {
      const key = details.keys().next().value!
      bytes -= details.get(key)!.bytes
      details.delete(key)
    }
  }

  const identity = (dir: string, base: string, anc: string, meta: Meta) =>
    zeroID(
      dir,
      base,
      anc,
      meta.file,
      meta.tracked,
      meta.status,
      meta.additions,
      meta.deletions,
      meta.binary,
      meta.stamp,
    )

  const cached = (id: string) => {
    const value = details.get(id)
    if (!value) return undefined
    details.delete(id)
    details.set(id, value)
    return value.value
  }

  const watch = (id: string, work: Promise<Value>, valid: () => boolean) => {
    pending.set(id, { work })
    work.then(
      (value) => {
        if (pending.get(id)?.work !== work) return
        pending.delete(id)
        if (!value || !valid()) return
        if (value.image?.before?.error === "unreadable" || value.image?.after?.error === "unreadable") return
        remember(id, value)
      },
      () => {
        if (pending.get(id)?.work === work) pending.delete(id)
      },
    )
    return work
  }

  const subscribe = (work: Promise<Value>, signal?: AbortSignal, cancel?: () => void): Promise<Value> => {
    if (signal?.aborted) return Promise.reject(new Error("Diff detail aborted"))
    return new Promise<Value>((resolve, reject) => {
      let done = false
      const abort = () => {
        if (done) return
        done = true
        signal?.removeEventListener("abort", abort)
        cancel?.()
        reject(new Error("Diff detail aborted"))
      }
      signal?.addEventListener("abort", abort, { once: true })
      work.then(
        (value) => {
          if (done) return
          done = true
          signal?.removeEventListener("abort", abort)
          resolve(value)
        },
        (error) => {
          if (done) return
          done = true
          signal?.removeEventListener("abort", abort)
          reject(error)
        },
      )
    })
  }

  const join = (item: Item, signal?: AbortSignal) => {
    if (signal?.aborted) return Promise.reject(new Error("Diff detail aborted"))
    const call: Call = { active: true, signal }
    item.calls.add(call)
    const work = subscribe(item.work, signal, () => {
      if (!call.active) return
      call.active = false
      item.calls.delete(call)
      if (item.started || item.calls.size !== 0) return
      const queue = queues.get(item.queue)
      if (queue?.get(item.id) === item) queue.delete(item.id)
      if (queue?.size === 0) queues.delete(item.queue)
      if (pending.get(item.id)?.work === item.work) pending.delete(item.id)
      item.reject(new Error("Diff detail aborted"))
    })
    const finish = () => {
      call.active = false
      item.calls.delete(call)
    }
    work.then(finish, finish)
    return work
  }

  const eligible = (meta: Meta) =>
    meta.tracked && !meta.binary && imageMime(meta.file) === undefined && !/[\r\n\t"\\]/.test(meta.file)

  const current = (item: Item) => {
    const state = states.get(item.scope)
    const meta = state?.metas.get(item.meta.file)
    if (!state || !meta) return undefined
    return { state, meta, id: identity(item.dir, item.base, state.anc, meta) }
  }

  const fallback = async (item: Item): Promise<Value> => {
    const latest = current(item)
    if (!latest) return null
    const value = cached(latest.id)
    if (value) return value
    const existing = pending.get(latest.id)
    if (existing && existing.item !== item) return existing.work
    const result = await load.detail(item.dir, latest.state.anc, latest.meta)
    if (current(item)?.id !== latest.id) return null
    if (result.image?.before?.error === "unreadable" || result.image?.after?.error === "unreadable") return result
    remember(latest.id, result)
    return result
  }

  const settle = async (item: Item, value: Value | undefined) => {
    if (current(item)?.id === item.id && value) {
      item.resolve(value)
      return
    }
    item.resolve(item.calls.size > 0 ? await fallback(item) : null)
  }

  const run = async (items: Item[]) => {
    for (let index = 0; index < items.length; index += MAX_BATCH_FILES) {
      const slice = items.slice(index, index + MAX_BATCH_FILES)
      const chunk = slice.filter((item) => item.calls.size > 0)
      if (chunk.length === 0) {
        for (const item of slice) item.resolve(null)
        continue
      }
      for (const item of chunk) item.started = true
      if (chunk.length === 1) {
        const item = chunk[0]!
        try {
          await settle(item, await load.detail(item.dir, item.anc, item.meta))
        } catch (error) {
          item.reject(error)
        }
        continue
      }
      const value = await load
        .batch(
          chunk[0]!.dir,
          chunk[0]!.anc,
          chunk.map((item) => item.meta),
        )
        .catch((error) => {
          load.log?.("Bulk diff detail failed, falling back to single-file requests", error)
          return undefined
        })
      await Promise.all(
        chunk.map(async (item) => {
          try {
            const entry = value?.deferred.has(item.meta.file) ? undefined : value?.entries.get(item.meta.file)
            await settle(item, entry)
          } catch (error) {
            item.reject(error)
          }
        }),
      )
    }
  }

  const schedule = (key: string) => {
    setImmediate(() => {
      const queue = queues.get(key)
      if (!queue) return
      queues.delete(key)
      const items = [...queue.values()].filter((item) => item.calls.size > 0)
      if (items.length === 0) return
      void run(items).catch((error) => {
        load.log?.("Bulk diff detail scheduling failed", error)
        for (const item of items) item.reject(error)
      })
    })
  }

  const queued = (id: string, dir: string, base: string, anc: string, meta: Meta, signal?: AbortSignal) => {
    const scope = zeroID(dir, base)
    const key = zeroID(scope, anc)
    let queue = queues.get(key)
    if (!queue) {
      queue = new Map()
      queues.set(key, queue)
      schedule(key)
    }
    let item = queue.get(id)
    if (!item) {
      const task = Promise.withResolvers<Value>()
      item = {
        id,
        scope,
        queue: key,
        dir,
        base,
        anc,
        meta,
        calls: new Set(),
        started: false,
        work: task.promise,
        resolve: task.resolve,
        reject: task.reject,
      }
      queue.set(id, item)
      watch(id, task.promise, () => current(item!)?.id === id && (item!.started || item!.calls.size > 0))
      pending.get(id)!.item = item
    }
    return join(item, signal)
  }

  const file = (dir: string, base: string, path: string, signal?: AbortSignal): Promise<Value> => {
    if (signal?.aborted) return Promise.reject(new Error("Diff detail aborted"))
    const state = states.get(zeroID(dir, base))
    if (!state) return load.file(dir, base, path, signal)
    const meta = state.metas.get(path)
    if (!meta) return Promise.resolve(null)
    const id = identity(dir, base, state.anc, meta)
    const value = cached(id)
    if (value) return Promise.resolve(value)
    const existing = pending.get(id)
    if (existing?.item) return join(existing.item, signal)
    if (existing) return subscribe(existing.work, signal)
    if (!eligible(meta)) {
      const work = load.detail(dir, state.anc, meta, signal)
      return subscribe(
        watch(id, work, () => !signal?.aborted),
        signal,
      )
    }
    return queued(id, dir, base, state.anc, meta, signal)
  }

  return {
    summary: async (dir: string, base: string): Promise<WorktreeDiffEntry[]> => {
      const id = zeroID(dir, base)
      const generation = (generations.get(id) ?? 0) + 1
      generations.set(id, generation)
      const result = await load.summary(dir, base)
      if (!result) {
        if (generations.get(id) === generation) states.delete(id)
        return []
      }
      if (generations.get(id) === generation) {
        states.delete(id)
        states.set(id, { anc: result.anc, metas: new Map(result.metas.map((meta) => [meta.file, meta])) })
        if (states.size > 16) states.delete(states.keys().next().value!)
      }
      return result.entries
    },
    file,
  }
}
