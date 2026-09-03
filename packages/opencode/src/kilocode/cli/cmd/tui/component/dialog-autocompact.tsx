// kilocode_change - new file
/**
 * Auto-Compact Threshold Dialog
 *
 * Lets the user pick the percentage of the context window at which
 * compaction runs automatically. Saves to the global config overlay via
 * `config.overlayUpdate`, so sibling compaction keys survive the patch.
 */

import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { reconcile } from "solid-js/store"

/** Preset percentages offered in the menu. */
export const AUTOCOMPACT_PRESETS: number[] = [50, 60, 70, 80, 90, 95]

/**
 * Parse a percentage typed into the custom prompt.
 * Returns `null` for an empty input (disable the percentage trigger),
 * `undefined` for a non-numeric input, otherwise the value clamped to [1, 100]
 * exactly like the VS Code context tab (`Math.min(100, Math.max(1, percent))`).
 */
export function parsePercent(raw: string): number | null | undefined {
  let text = raw.trim()
  if (!text) return null
  if (text.endsWith("%")) {
    text = text.slice(0, -1).trim()
    if (!text) return undefined
  }
  const percent = Number(text)
  if (!Number.isFinite(percent)) return undefined
  return Math.min(100, Math.max(1, percent))
}

export type ThresholdPatch = ReturnType<typeof thresholdPatch>

/**
 * Build the overlay patch for a threshold.
 * `patchJsonc` merges per key, so sibling compaction keys survive.
 */
export function thresholdPatch(percent: number | null) {
  if (percent === null) return { unset: [["compaction", "threshold_percent"]] }
  return { set: { compaction: { threshold_percent: percent } } }
}

/** Display label for a threshold value: `"80%"` or `"Only when full"`. */
export function thresholdLabel(percent: number | null | undefined): string {
  if (typeof percent === "number") return `${percent}%`
  return "Only when full"
}

/**
 * Map a threshold value to the menu option that represents it:
 * a preset number returns itself, any other number returns `"custom"`,
 * and `null`/`undefined` return `"off"`.
 */
export function currentOption(current: number | null | undefined): number | "custom" | "off" {
  if (current === null || current === undefined) return "off"
  return AUTOCOMPACT_PRESETS.includes(current) ? current : "custom"
}

/** Menu options: presets, a custom entry, and the default "off" entry. */
export function thresholdOptions(current: number | null | undefined): DialogSelectOption<number | "custom" | "off">[] {
  const options: DialogSelectOption<number | "custom" | "off">[] = AUTOCOMPACT_PRESETS.map((preset) => ({
    value: preset,
    title: thresholdLabel(preset),
    category: "Threshold",
    description: preset === current ? "(current)" : undefined,
  }))
  const customTitle = currentOption(current) === "custom" ? `Custom (${current}%)` : "Custom…"
  options.push({ value: "custom", title: customTitle, category: "Threshold" })
  const off = current === null || current === undefined
  options.push({
    value: "off",
    title: "Only when full",
    category: "Threshold",
    description: off
      ? "Compact when the context window is nearly full (default) (current)"
      : "Compact when the context window is nearly full (default)",
  })
  return options
}

export type ThresholdSaveDeps = {
  overlayUpdate: (input: { scope: "global" } & ThresholdPatch) => Promise<{ error?: unknown }>
  getConfig: () => Promise<{ data?: unknown }>
  getGlobalConfig: () => Promise<{ data?: unknown }>
  setStore: (key: "config" | "globalConfig", value: unknown) => void
  toast: (input: { message: string; variant: "success" | "error" }) => void
}

/**
 * Write the threshold to the global config overlay, then refetch both config
 * stores. Returns `false` when the write failed; the caller keeps the dialog
 * open so the user can retry.
 */
export async function saveThreshold(percent: number | null, deps: ThresholdSaveDeps): Promise<boolean> {
  const result = await deps.overlayUpdate({ scope: "global", ...thresholdPatch(percent) })
  if (result.error) {
    deps.toast({ message: "Failed to save auto-compact threshold", variant: "error" })
    return false
  }
  const [configResponse, globalResponse] = await Promise.all([deps.getConfig(), deps.getGlobalConfig()])
  if (configResponse.data) deps.setStore("config", reconcile(configResponse.data))
  if (globalResponse.data) deps.setStore("globalConfig", reconcile(globalResponse.data))
  const label = percent === null ? thresholdLabel(percent).toLowerCase() : thresholdLabel(percent)
  deps.toast({ message: `Auto-compact set to ${label}`, variant: "success" })
  return true
}

export function DialogAutocompact() {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()

  const current = (): number | null => {
    const value = sync.data.config.compaction?.threshold_percent
    return typeof value === "number" ? value : null
  }

  async function save(percent: number | null) {
    const saved = await saveThreshold(percent, {
      overlayUpdate: (input) => sdk.client.config.overlayUpdate(input),
      getConfig: () => sdk.client.config.get({}),
      getGlobalConfig: () => sdk.client.global.config.get({}),
      setStore: (key, value) => sync.set(key, value as never),
      toast: (input) => toast.show(input),
    })
    if (!saved) return
    dialog.clear()
  }

  return (
    <DialogSelect
      title="Auto-Compact Threshold"
      options={thresholdOptions(current())}
      current={currentOption(current())}
      skipFilter
      onSelect={async (option) => {
        const value = option.value
        if (value === "custom") {
          const result = await DialogPrompt.show(dialog, "Auto-compact threshold (%)", {
            value: typeof current() === "number" ? String(current()) : "",
            placeholder: "1–100, empty to disable",
          })
          if (result === null) {
            dialog.replace(() => <DialogAutocompact />)
            return
          }
          const percent = parsePercent(result)
          if (percent === undefined) {
            toast.show({ message: `Invalid percentage: "${result.trim()}"`, variant: "error" })
            dialog.replace(() => <DialogAutocompact />)
            return
          }
          await save(percent)
          return
        }
        await save(value === "off" ? null : value)
      }}
    />
  )
}
