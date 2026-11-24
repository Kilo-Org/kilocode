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
  type ComposerDraftState,
} from "../webview-ui/src/v2/auto-model-preview-state"

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

  test("shows preview only for explicit non-auto models after typing a prompt", () => {
    const explicit: ModelRef = { providerID: "kilo", id: "anthropic/claude-opus-4.6" }
    const auto: ModelRef = { providerID: "kilo", id: "kilo-auto/efficient" }

    expect(canPreviewAutoModel({ model: explicit, text: "", goal: false, disabled: false })).toBe(false)
    expect(canPreviewAutoModel({ model: explicit, text: "   \n ", goal: false, disabled: false })).toBe(false)
    expect(canPreviewAutoModel({ model: auto, text: "Refactor auth helper", goal: false, disabled: false })).toBe(false)
    expect(canPreviewAutoModel({ model: explicit, text: "Refactor auth helper", goal: true, disabled: false })).toBe(
      false,
    )
    expect(canPreviewAutoModel({ model: explicit, text: "Refactor auth helper", goal: false, disabled: true })).toBe(
      false,
    )
    expect(canPreviewAutoModel({ model: explicit, text: "Refactor auth helper", goal: false, disabled: false })).toBe(
      true,
    )
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
  test("fetches preview, marks stale when prompt edits, refreshes on toggle, and closes on auto model or clear", async () => {
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

      expect(controller.visible()).toBe(true)
      expect(controller.open()).toBe(false)

      controller.toggle()
      expect(controller.open()).toBe(true)
      expect(controller.loading()).toBe(true)
      await flush()

      expect(controller.loading()).toBe(false)
      expect(controller.result()?.selection.modelName).toBe("Claude Sonnet")
      expect(calls).toHaveLength(1)
      expect(calls[0]?.currentModel?.name).toBe("Claude Opus 4.6")

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

      // Switching to an Auto model hides the preview trigger.
      setModel({ providerID: "kilo", id: "kilo-auto/efficient" })
      expect(controller.visible()).toBe(false)

      // Returning to an explicit model restores visibility; clearing prompt hides it again.
      setModel({ providerID: "kilo", id: "anthropic/claude-opus-4.6" })
      expect(controller.visible()).toBe(true)
      setDraft({ text: "", goal: false })
      expect(controller.visible()).toBe(false)
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
