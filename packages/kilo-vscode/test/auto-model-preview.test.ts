import { describe, expect, test } from "bun:test"
import type { ModelRef } from "@opencode/client"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { createRoot, createSignal } from "solid-js"
import { dict as en } from "@kilocode/kilo-i18n/en"
import { dict as ar } from "@kilocode/kilo-i18n/ar"
import { dict as br } from "@kilocode/kilo-i18n/br"
import { dict as bs } from "@kilocode/kilo-i18n/bs"
import { dict as da } from "@kilocode/kilo-i18n/da"
import { dict as de } from "@kilocode/kilo-i18n/de"
import { dict as es } from "@kilocode/kilo-i18n/es"
import { dict as fr } from "@kilocode/kilo-i18n/fr"
import { dict as it } from "@kilocode/kilo-i18n/it"
import { dict as ja } from "@kilocode/kilo-i18n/ja"
import { dict as ko } from "@kilocode/kilo-i18n/ko"
import { dict as nl } from "@kilocode/kilo-i18n/nl"
import { dict as no } from "@kilocode/kilo-i18n/no"
import { dict as pl } from "@kilocode/kilo-i18n/pl"
import { dict as ru } from "@kilocode/kilo-i18n/ru"
import { dict as th } from "@kilocode/kilo-i18n/th"
import { dict as tr } from "@kilocode/kilo-i18n/tr"
import { dict as uk } from "@kilocode/kilo-i18n/uk"
import { dict as zh } from "@kilocode/kilo-i18n/zh"
import { dict as zht } from "@kilocode/kilo-i18n/zht"
import {
  canPreviewAutoModel,
  createAutoModelPreview,
  formatEstimatedCost,
  isAutoModelRef,
  modelKindOf,
  profileForAutoModel,
  type ComposerDraftState,
} from "../webview-ui/src/v2/auto-model-preview-state"
import {
  AutoModelPreviewTelemetryEvent,
  captureAutoModelPreviewTelemetry,
  setAutoModelPreviewTelemetrySink,
} from "../src/services/auto-model-preview-telemetry"
import type { AutoModelPreviewTelemetryPayload } from "../src/shared/auto-model-preview-telemetry"

const SAMPLE: KiloGatewayRpc.AutoModelPreviewResult = {
  profile: "efficient",
  task: {
    category: "Code refactoring & tests",
    summary: "Updating existing code and adding test coverage",
  },
  attributes: {
    contextComplexity: "Medium",
    reasoningComplexity: "Medium",
    risk: { level: "high", detail: "authentication" },
    executionMode: "Code change",
    toolsRequired: true,
  },
  selection: {
    modelID: "anthropic/claude-sonnet-4.6",
    modelName: "Claude Sonnet",
    rationale: "A good fit for a focused code change: strong coding performance at a lower estimated cost.",
  },
  candidates: [
    {
      modelID: "anthropic/claude-sonnet-4.6",
      modelName: "Claude Sonnet",
      estimatedCostUsd: 0.04,
      taskFit: "high",
      predicted: true,
    },
    {
      modelID: "anthropic/claude-opus-4.6",
      modelName: "Claude Opus",
      estimatedCostUsd: 0.16,
      taskFit: "very_high",
      predicted: false,
      current: true,
    },
  ],
  recommendation: {
    suggestedProfile: "frontier",
    reason: "for this security-sensitive change if you value the extra task fit over the higher estimated cost.",
  },
  illustrative: true,
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("auto-model preview visibility & formatting", () => {
  test("detects auto models vs explicit models", () => {
    expect(isAutoModelRef({ providerID: "kilo", id: "kilo-auto/efficient" })).toBe(true)
    expect(isAutoModelRef({ providerID: "kilo", id: "kilo-auto/frontier" })).toBe(true)
    expect(isAutoModelRef({ providerID: "kilo", id: "kilo-auto/free" })).toBe(true)
    expect(isAutoModelRef({ providerID: "kilo", id: "kilo-auto/custom/org-router" })).toBe(true)
    expect(isAutoModelRef({ providerID: "kilo", id: "kilo-auto/small" })).toBe(true)
    expect(isAutoModelRef({ providerID: "custom", id: "auto-efficient" })).toBe(true)

    expect(isAutoModelRef({ providerID: "kilo", id: "anthropic/claude-opus-4.6" })).toBe(false)
    expect(isAutoModelRef({ providerID: "anthropic", id: "claude-sonnet-4-6" })).toBe(false)
    expect(isAutoModelRef(undefined)).toBe(false)
  })

  test("derives frontier vs efficient profile for auto models", () => {
    expect(profileForAutoModel({ providerID: "kilo", id: "kilo-auto/efficient" })).toBe("efficient")
    expect(profileForAutoModel({ providerID: "kilo", id: "kilo-auto/frontier" })).toBe("frontier")
    expect(profileForAutoModel({ providerID: "kilo", id: "kilo-auto/free" })).toBe("efficient")
    expect(profileForAutoModel({ providerID: "kilo", id: "anthropic/claude-opus-4.6" })).toBeUndefined()
    expect(profileForAutoModel(undefined)).toBeUndefined()
  })

  test("enables preview after typing a prompt regardless of whether an auto or explicit model is selected", () => {
    expect(canPreviewAutoModel({ text: "", goal: false, disabled: false })).toBe(false)
    expect(canPreviewAutoModel({ text: "   \n ", goal: false, disabled: false })).toBe(false)
    expect(canPreviewAutoModel({ text: "Refactor auth helper", goal: true, disabled: false })).toBe(false)
    expect(canPreviewAutoModel({ text: "Refactor auth helper", goal: false, disabled: true })).toBe(false)
    expect(canPreviewAutoModel({ text: "Refactor auth helper", goal: false, disabled: false })).toBe(true)
  })

  test("classifies privacy-safe model kinds for telemetry", () => {
    expect(modelKindOf({ providerID: "kilo", id: "kilo-auto/efficient" })).toBe("auto_efficient")
    expect(modelKindOf({ providerID: "kilo", id: "kilo-auto/frontier" })).toBe("auto_frontier")
    expect(modelKindOf({ providerID: "kilo", id: "kilo-auto/free" })).toBe("auto_other")
    expect(modelKindOf({ providerID: "kilo", id: "anthropic/claude-opus-4.6" })).toBe("explicit")
    expect(modelKindOf(undefined)).toBe("unknown")
  })

  test("formats estimated cost values consistently", () => {
    expect(formatEstimatedCost(0.04, "Not available.")).toBe("~$0.04")
    expect(formatEstimatedCost(0.16, "Not available.")).toBe("~$0.16")
    expect(formatEstimatedCost(0.002, "Not available.")).toBe("<$0.01")
    expect(formatEstimatedCost(0, "Not available.")).toBe("$0.00")
    expect(formatEstimatedCost(null, "Not available.")).toBe("Not available.")
  })
})

describe("createAutoModelPreview controller", () => {
  test("fetches preview for both explicit and auto models, marks stale on edits, and disables when prompt is empty", async () => {
    const calls: KiloGatewayRpc.AutoModelPreviewInput[] = []
    let dispose: (() => void) | undefined

    await createRoot(async (cleanup) => {
      dispose = cleanup
      const [draft, setDraft] = createSignal<ComposerDraftState>({
        text: "Refactor authentication helper",
        goal: false,
      })
      const [model, setModel] = createSignal<ModelRef | undefined>({
        providerID: "kilo",
        id: "anthropic/claude-opus-4.6",
      })
      const controller = createAutoModelPreview({
        request: async (input) => {
          calls.push(input)
          return SAMPLE
        },
        draft,
        model,
        models: () => [{ providerID: "kilo", id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" } as never],
        agent: () => "code",
        disabled: () => false,
      })

      expect(controller.enabled()).toBe(true)
      expect(controller.open()).toBe(false)

      controller.toggle()
      expect(controller.open()).toBe(true)
      expect(controller.loading()).toBe(true)
      await flush()

      expect(controller.loading()).toBe(false)
      expect(controller.result()?.selection.modelName).toBe("Claude Sonnet")
      expect(calls).toHaveLength(1)
      expect(calls[0]?.currentModel?.name).toBe("Claude Opus 4.6")
      expect(calls[0]?.profile).toBeUndefined()

      // Editing the prompt marks the open preview stale; clicking toggle refreshes instead of closing.
      setDraft({ text: "Refactor authentication helper and add token rotation", goal: false })
      expect(controller.stale()).toBe(true)
      controller.toggle()
      await flush()
      expect(controller.open()).toBe(true)
      expect(controller.stale()).toBe(false)
      expect(calls).toHaveLength(2)

      // Toggling when prompt is unchanged closes the preview cleanly.
      controller.toggle()
      expect(controller.open()).toBe(false)

      // Switching to Auto Frontier keeps preview enabled and requests the frontier profile without a virtual currentModel.
      setModel({ providerID: "kilo", id: "kilo-auto/frontier" })
      expect(controller.enabled()).toBe(true)
      controller.toggle()
      await flush()
      expect(calls).toHaveLength(3)
      expect(calls[2]?.profile).toBe("frontier")
      expect(calls[2]?.currentModel).toBeUndefined()

      // Clearing the prompt disables preview.
      setDraft({ text: "", goal: false })
      expect(controller.enabled()).toBe(false)
    })

    dispose?.()
  })

  test("recovers from errors with retry", async () => {
    let attempts = 0
    let dispose: (() => void) | undefined

    await createRoot(async (cleanup) => {
      dispose = cleanup
      const controller = createAutoModelPreview({
        request: async () => {
          attempts++
          if (attempts === 1) throw new Error("Gateway unreachable")
          return SAMPLE
        },
        draft: () => ({ text: "Fix login bug", goal: false }),
        model: () => ({ providerID: "kilo", id: "anthropic/claude-opus-4.6" }),
        models: () => [],
        agent: () => "code",
        disabled: () => false,
      })

      controller.toggle()
      await flush()
      expect(controller.open()).toBe(true)
      expect(controller.error()).toBe("Gateway unreachable")

      controller.refresh()
      await flush()
      expect(controller.error()).toBeUndefined()
      expect(controller.result()?.task.category).toBe("Code refactoring & tests")
    })

    dispose?.()
  })

  test("serves repeated clicks from cache with a single RPC while recording every click metric", async () => {
    let calls = 0
    const events: AutoModelPreviewTelemetryPayload[] = []
    let dispose: (() => void) | undefined

    await createRoot(async (cleanup) => {
      dispose = cleanup
      const controller = createAutoModelPreview({
        request: async () => {
          calls++
          return SAMPLE
        },
        draft: () => ({ text: "Refactor authentication helper", goal: false }),
        model: () => ({ providerID: "kilo", id: "kilo-auto/efficient" }),
        models: () => [],
        agent: () => "code",
        disabled: () => false,
        onTelemetry: (event) => events.push(event),
      })

      // First click hits network.
      controller.toggle()
      await flush()
      expect(calls).toBe(1)

      // Toggle closed & reopened 5 more times (12 clicks total): all subsequent opens hit local cache with 0 RPCs.
      for (let i = 0; i < 5; i++) {
        controller.toggle()
        expect(controller.open()).toBe(false)
        controller.toggle()
        expect(controller.open()).toBe(true)
        expect(controller.loading()).toBe(false)
      }
      controller.toggle()
      expect(controller.open()).toBe(false)

      expect(calls).toBe(1)

      const clicks = events.filter((item) => item.kind === "clicked")
      expect(clicks).toHaveLength(12)
      expect(clicks[0]).toMatchObject({
        action: "open",
        source: "network",
        modelKind: "auto_efficient",
        clicksForDraft: 1,
        clicksTotal: 1,
        stale: false,
      })
      expect(clicks[1]).toMatchObject({ action: "close", source: "none", clicksForDraft: 2, clicksTotal: 2 })
      expect(clicks[2]).toMatchObject({ action: "open", source: "cache", clicksForDraft: 3, clicksTotal: 3 })
      expect(clicks.at(-1)).toMatchObject({ action: "close", source: "none", clicksForDraft: 12, clicksTotal: 12 })

      const resolved = events.filter((item) => item.kind === "resolved")
      expect(resolved).toHaveLength(1)
      expect(resolved[0]).toMatchObject({
        outcome: "success",
        modelKind: "auto_efficient",
        profile: "efficient",
        illustrative: true,
      })
    })

    dispose?.()
  })

  test("coalesces rapid clicks while a request is still in flight", async () => {
    let calls = 0
    const pending = Promise.withResolvers<KiloGatewayRpc.AutoModelPreviewResult>()
    const events: AutoModelPreviewTelemetryPayload[] = []
    let dispose: (() => void) | undefined

    await createRoot(async (cleanup) => {
      dispose = cleanup
      const controller = createAutoModelPreview({
        request: () => {
          calls++
          return pending.promise
        },
        draft: () => ({ text: "Fix race condition", goal: false }),
        model: () => ({ providerID: "kilo", id: "kilo-auto/efficient" }),
        models: () => [],
        agent: () => "code",
        disabled: () => false,
        onTelemetry: (event) => events.push(event),
      })

      // Click 1: opens and starts network request.
      controller.toggle()
      expect(controller.open()).toBe(true)
      expect(controller.loading()).toBe(true)

      // Click 2: closes while still loading.
      controller.toggle()
      expect(controller.open()).toBe(false)

      // Click 3: reopens while the same request is still pending -> joins in-flight instead of starting a 2nd RPC.
      controller.toggle()
      expect(controller.open()).toBe(true)
      expect(controller.loading()).toBe(true)
      expect(calls).toBe(1)

      pending.resolve(SAMPLE)
      await flush()
      expect(controller.loading()).toBe(false)
      expect(controller.result()).toEqual(SAMPLE)

      const clicks = events.filter((item) => item.kind === "clicked")
      expect(clicks.map((item) => [item.action, item.source])).toEqual([
        ["open", "network"],
        ["close", "none"],
        ["open", "inflight"],
      ])
    })

    dispose?.()
  })

  test("reuses cache on model flip-flop, undo-edit, and respects TTL and LRU bounds", async () => {
    let calls = 0
    let now = 1_000
    let dispose: (() => void) | undefined

    await createRoot(async (cleanup) => {
      dispose = cleanup
      const [draft, setDraft] = createSignal<ComposerDraftState>({ text: "Prompt A", goal: false })
      const [model, setModel] = createSignal<ModelRef | undefined>({
        providerID: "kilo",
        id: "kilo-auto/efficient",
      })
      const controller = createAutoModelPreview({
        request: async (payload) => {
          calls++
          return { ...SAMPLE, profile: payload.profile ?? "efficient" }
        },
        draft,
        model,
        models: () => [],
        agent: () => "code",
        disabled: () => false,
        cacheMaxEntries: 2,
        cacheTtlMs: 5_000,
        now: () => now,
      })

      controller.toggle()
      await flush()
      expect(calls).toBe(1)

      // Switch to Auto Frontier (new cache entry) and back to Auto Efficient (cache hit).
      controller.close()
      setModel({ providerID: "kilo", id: "kilo-auto/frontier" })
      controller.toggle()
      await flush()
      expect(calls).toBe(2)
      expect(controller.result()?.profile).toBe("frontier")

      controller.close()
      setModel({ providerID: "kilo", id: "kilo-auto/efficient" })
      controller.toggle()
      await flush()
      expect(calls).toBe(2)
      expect(controller.result()?.profile).toBe("efficient")

      // Edit prompt to Prompt B (evicts Frontier because Efficient was just touched), then undo back to Prompt A (cache hit).
      setDraft({ text: "Prompt B", goal: false })
      controller.toggle()
      await flush()
      expect(calls).toBe(3)

      setDraft({ text: "Prompt A", goal: false })
      controller.toggle()
      await flush()
      expect(calls).toBe(3)

      // Expire TTL -> next open fetches again.
      controller.close()
      now += 5_000
      controller.toggle()
      await flush()
      expect(calls).toBe(4)
    })

    dispose?.()
  })

  test("tracks never-clicked and multi-click prompt submissions and resets per-draft click counters", async () => {
    const events: AutoModelPreviewTelemetryPayload[] = []
    let dispose: (() => void) | undefined

    await createRoot(async (cleanup) => {
      dispose = cleanup
      const controller = createAutoModelPreview({
        request: async () => SAMPLE,
        draft: () => ({ text: "Write migration script", goal: false }),
        model: () => ({ providerID: "kilo", id: "anthropic/claude-opus-4.6" }),
        models: () => [],
        agent: () => "code",
        disabled: () => false,
        onTelemetry: (event) => events.push(event),
      })

      // Submitting without ever clicking Preview reports 0 clicks.
      controller.recordPromptSubmitted()
      expect(events.at(-1)).toEqual({
        kind: "prompt_submitted",
        previewClicks: 0,
        previewed: false,
        modelKind: "explicit",
      })

      // Click Preview three times (open, close, reopen), then submit.
      controller.toggle()
      await flush()
      controller.toggle()
      controller.toggle()
      controller.recordPromptSubmitted({ providerID: "kilo", id: "kilo-auto/efficient" })
      expect(events.at(-1)).toEqual({
        kind: "prompt_submitted",
        previewClicks: 3,
        previewed: true,
        modelKind: "auto_efficient",
      })

      // Next draft starts with clicksForDraft reset to 1 while clicksTotal keeps incrementing.
      controller.toggle()
      const lastClick = events.filter((item) => item.kind === "clicked").at(-1)
      expect(lastClick).toMatchObject({ clicksForDraft: 1, clicksTotal: 4 })
    })

    dispose?.()
  })
})

describe("auto-model preview host telemetry sink", () => {
  test("gates events on VS Code telemetry consent and forwards structured event names", () => {
    const captured: Array<{ event: string; properties: Record<string, unknown> }> = []
    setAutoModelPreviewTelemetrySink((event, properties) => captured.push({ event, properties }))

    try {
      const clicked: AutoModelPreviewTelemetryPayload = {
        kind: "clicked",
        action: "open",
        source: "cache",
        modelKind: "auto_efficient",
        promptLength: 42,
        clicksForDraft: 4,
        clicksTotal: 9,
        stale: false,
        agent: "code",
      }
      const submitted: AutoModelPreviewTelemetryPayload = {
        kind: "prompt_submitted",
        previewClicks: 0,
        previewed: false,
        modelKind: "explicit",
      }

      // Blocked when telemetry is disabled.
      captureAutoModelPreviewTelemetry(clicked, { telemetryEnabled: false })
      expect(captured).toHaveLength(0)

      // Forwarded when telemetry is enabled.
      captureAutoModelPreviewTelemetry(clicked, { telemetryEnabled: true })
      captureAutoModelPreviewTelemetry(submitted, { telemetryEnabled: true })

      expect(captured).toEqual([
        {
          event: AutoModelPreviewTelemetryEvent.PREVIEW_CLICKED,
          properties: {
            action: "open",
            source: "cache",
            modelKind: "auto_efficient",
            promptLength: 42,
            clicksForDraft: 4,
            clicksTotal: 9,
            stale: false,
            agent: "code",
          },
        },
        {
          event: AutoModelPreviewTelemetryEvent.PREVIEW_PROMPT_SUBMITTED,
          properties: {
            previewClicks: 0,
            previewed: false,
            modelKind: "explicit",
          },
        },
      ])
    } finally {
      setAutoModelPreviewTelemetrySink(undefined)
    }
  })
})

describe("autoModel.preview i18n parity", () => {
  test("every locale defines every autoModel.preview key with matching placeholders", () => {
    const keys = Object.keys(en).filter((key) => key.startsWith("autoModel.preview."))
    expect(keys.length).toBeGreaterThan(25)

    const locales: Record<string, Record<string, string>> = {
      ar,
      br,
      bs,
      da,
      de,
      es,
      fr,
      it,
      ja,
      ko,
      nl,
      no,
      pl,
      ru,
      th,
      tr,
      uk,
      zh,
      zht,
    }

    for (const [locale, dict] of Object.entries(locales)) {
      for (const key of keys) {
        expect(dict[key], `${locale} missing ${key}`).toBeTruthy()
        const expectedVars = [...en[key as keyof typeof en].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
        const actualVars = [...(dict[key] ?? "").matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
        expect(actualVars, `${locale} placeholder mismatch for ${key}`).toEqual(expectedVars)
      }
    }
  })
})
