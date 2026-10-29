// The `kilo-code.v2.*` VS Code settings. The host inlines them as `window.KILO_SETTINGS` and pushes a fresh set on
// change; this module keeps the latest values, applies the font size to the page, and reads the Shift+Tab toggle.
import { createSignal } from "solid-js"

const SIZES = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]

function initial(): Record<string, unknown> {
  const value = (window as unknown as { KILO_SETTINGS?: Record<string, unknown> }).KILO_SETTINGS
  return value && typeof value === "object" ? value : {}
}

const clamp = (value: number) => Math.min(24, Math.max(10, Math.round(value)))

/** Clamp a font size to the v1 slider range, or `undefined` when the value is not a finite number. */
export function clampFontSize(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value) : undefined
}

/** The effective font size inlined at boot, from the CSS variables the host wrote. */
const bootSize = (() => {
  const px = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--kilo-font-size-13"))
  return Number.isFinite(px) ? clamp(px) : 13
})()

/** The font size shown when no explicit `kilo-code.v2.fontSize` is set. */
export function bootFontSize(): number {
  return bootSize
}

/** The host's current fallback size (the pushed `effectiveFontSize`), or the boot size when the host has not sent one. */
export function fallbackFontSize(): number {
  return clampFontSize(kiloSettings().effectiveFontSize) ?? bootSize
}

const [kiloSettings, setKiloSettings] = createSignal<Record<string, unknown>>(initial())
export { kiloSettings }

/** Scale the `--kilo-font-size-*` variables, as the host writes them into the page. */
export function applyFontSize(size: number) {
  const root = document.documentElement
  for (const step of SIZES) root.style.setProperty(`--kilo-font-size-${step}`, `${(size * step) / 13}px`)
  root.style.setProperty("--kilo-font-scale", String(size / 13))
}

/** Replace the settings values and apply the font size, or reset it to the boot size when unset. */
export function applyKiloSettings(values: Record<string, unknown>) {
  setKiloSettings(values)
  applyFontSize(clampFontSize(values.fontSize) ?? clampFontSize(values.effectiveFontSize) ?? bootSize)
}

/** `kilo-code.v2.chat.shiftTabCyclesVariant`, on by default. */
export function shiftTabCyclesVariant(): boolean {
  return kiloSettings()["chat.shiftTabCyclesVariant"] !== false
}
