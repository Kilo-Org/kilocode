/**
 * Regression: when the Kilo gateway returns an empty embedding-model catalog
 * (network/auth race on first webview boot), the IndexingTab fell back to the
 * literal "provider/model" placeholder until a full webview reload. The fix
 * is two-layered:
 *
 *   1. Webview-side retry: re-request the catalog while it stays empty,
 *      mirroring the indexing.tsx retry shape.
 *   2. Extension-side: never replace a non-empty catalog with an empty one.
 *
 * These tests cover both layers via the pure helpers exposed for testing.
 */

import { describe, expect, it } from "bun:test"
import {
  EMPTY_KILO_EMBEDDING_MODEL_CATALOG,
  type KiloEmbeddingModelCatalog,
} from "@kilocode/kilo-indexing/embedding-models"
import {
  isEmptyKiloEmbeddingCatalog,
  KILO_EMBEDDING_MAX_RETRIES,
  subscribeKiloEmbeddingModels,
} from "../../webview-ui/src/context/kilo-embedding-models-subscribe"
import type { ExtensionMessage, WebviewMessage } from "../../webview-ui/src/types/messages"

const realCatalog: KiloEmbeddingModelCatalog = {
  defaultModel: "kilo/code-embedding-4k",
  models: [{ id: "kilo/code-embedding-4k", name: "Code Embedding 4k", dimension: 1024, scoreThreshold: 0.4 }],
  aliases: {},
}

type FakeTimer = { fn: () => void; ms: number }

function createFakeTimers() {
  const timers = new Map<number, FakeTimer>()
  let next = 1
  const setIntervalFn = ((fn: () => void, ms: number) => {
    const id = next++
    timers.set(id, { fn, ms })
    return id as unknown as ReturnType<typeof setInterval>
  }) as typeof setInterval
  const clearIntervalFn = ((id: ReturnType<typeof setInterval>) => {
    timers.delete(id as unknown as number)
  }) as typeof clearInterval
  return {
    setIntervalFn,
    clearIntervalFn,
    tick: () => {
      // Snapshot to avoid mutation during iteration.
      for (const t of [...timers.values()]) t.fn()
    },
    pending: () => timers.size,
  }
}

function createHarness() {
  const posted: WebviewMessage[] = []
  const handlers = new Set<(m: ExtensionMessage) => void>()
  let stored: KiloEmbeddingModelCatalog = EMPTY_KILO_EMBEDDING_MODEL_CATALOG
  return {
    posted,
    deliver: (m: ExtensionMessage) => handlers.forEach((h) => h(m)),
    getCatalog: () => stored,
    setCatalog: (next: KiloEmbeddingModelCatalog) => {
      stored = next
    },
    postMessage: (m: WebviewMessage) => {
      posted.push(m)
    },
    onMessage: (h: (m: ExtensionMessage) => void) => {
      handlers.add(h)
      return () => handlers.delete(h)
    },
  }
}

describe("isEmptyKiloEmbeddingCatalog", () => {
  it("treats EMPTY_KILO_EMBEDDING_MODEL_CATALOG as empty", () => {
    expect(isEmptyKiloEmbeddingCatalog(EMPTY_KILO_EMBEDDING_MODEL_CATALOG)).toBe(true)
  })

  it("treats a defaultModel-only payload as empty (models[] missing)", () => {
    expect(isEmptyKiloEmbeddingCatalog({ defaultModel: "x", models: [], aliases: {} })).toBe(true)
  })

  it("treats a catalog with models but no defaultModel as empty", () => {
    expect(
      isEmptyKiloEmbeddingCatalog({
        defaultModel: "",
        models: realCatalog.models,
        aliases: {},
      }),
    ).toBe(true)
  })

  it("recognises a real catalog as non-empty", () => {
    expect(isEmptyKiloEmbeddingCatalog(realCatalog)).toBe(false)
  })
})

describe("subscribeKiloEmbeddingModels (webview retry)", () => {
  it("posts the initial request immediately on subscribe", () => {
    const h = createHarness()
    const timers = createFakeTimers()
    const cleanup = subscribeKiloEmbeddingModels({
      ...h,
      setInterval: timers.setIntervalFn,
      clearInterval: timers.clearIntervalFn,
    })

    expect(h.posted).toEqual([{ type: "requestKiloEmbeddingModels" }])
    cleanup()
  })

  it("retries while the catalog stays empty", () => {
    const h = createHarness()
    const timers = createFakeTimers()
    const cleanup = subscribeKiloEmbeddingModels({
      ...h,
      setInterval: timers.setIntervalFn,
      clearInterval: timers.clearIntervalFn,
    })

    // Empty catalog "received" — should keep retrying.
    h.deliver({ type: "kiloEmbeddingModelsLoaded", catalog: EMPTY_KILO_EMBEDDING_MODEL_CATALOG })

    timers.tick()
    timers.tick()

    expect(h.posted.length).toBe(3) // initial + 2 retries
    cleanup()
  })

  it("stops retrying once a non-empty catalog arrives", () => {
    const h = createHarness()
    const timers = createFakeTimers()
    const cleanup = subscribeKiloEmbeddingModels({
      ...h,
      setInterval: timers.setIntervalFn,
      clearInterval: timers.clearIntervalFn,
    })

    h.deliver({ type: "kiloEmbeddingModelsLoaded", catalog: realCatalog })

    timers.tick()
    timers.tick()
    timers.tick()

    // Only the initial request — retries must short-circuit once we have a catalog.
    expect(h.posted.length).toBe(1)
    expect(h.getCatalog()).toEqual(realCatalog)
    cleanup()
  })

  it("does not exceed the retry cap", () => {
    const h = createHarness()
    const timers = createFakeTimers()
    const cleanup = subscribeKiloEmbeddingModels({
      ...h,
      setInterval: timers.setIntervalFn,
      clearInterval: timers.clearIntervalFn,
    })

    for (let i = 0; i < KILO_EMBEDDING_MAX_RETRIES + 5; i++) timers.tick()

    // Initial request + exactly MAX_RETRIES re-posts.
    expect(h.posted.length).toBe(1 + KILO_EMBEDDING_MAX_RETRIES)
    cleanup()
  })

  it("ignores empty catalogs delivered after a non-empty one (no regression to placeholder)", () => {
    const h = createHarness()
    const timers = createFakeTimers()
    const cleanup = subscribeKiloEmbeddingModels({
      ...h,
      setInterval: timers.setIntervalFn,
      clearInterval: timers.clearIntervalFn,
    })

    h.deliver({ type: "kiloEmbeddingModelsLoaded", catalog: realCatalog })
    expect(h.getCatalog()).toEqual(realCatalog)

    // Late empty payload (e.g. another extension push). Must NOT clobber the
    // good catalog or IndexingTab will fall back to "provider/model".
    h.deliver({ type: "kiloEmbeddingModelsLoaded", catalog: EMPTY_KILO_EMBEDDING_MODEL_CATALOG })

    expect(h.getCatalog()).toEqual(realCatalog)
    cleanup()
  })

  it("clears the retry timer on cleanup", () => {
    const h = createHarness()
    const timers = createFakeTimers()
    const cleanup = subscribeKiloEmbeddingModels({
      ...h,
      setInterval: timers.setIntervalFn,
      clearInterval: timers.clearIntervalFn,
    })

    expect(timers.pending()).toBe(1)
    cleanup()
    expect(timers.pending()).toBe(0)
  })
})
