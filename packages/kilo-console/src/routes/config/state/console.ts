import { createEffect, createSignal } from "solid-js"
import { useConfig } from "../../../context/config"

export const DEFAULT_CONTEXT_SIDEBAR_WIDTH = 300
export const MIN_CONTEXT_SIDEBAR_WIDTH = 250
export const MAX_CONTEXT_SIDEBAR_WIDTH = 800
export const DEFAULT_CONSOLE_DIFF_STYLE = "unified" as const
export type ConsoleDiffStyle = "unified" | "split"

export function normalizeConsoleDiffStyle(value: unknown): ConsoleDiffStyle {
  return value === "split" ? "split" : DEFAULT_CONSOLE_DIFF_STYLE
}

export function normalizeContextSidebarWidth(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CONTEXT_SIDEBAR_WIDTH
  return Math.min(MAX_CONTEXT_SIDEBAR_WIDTH, Math.max(MIN_CONTEXT_SIDEBAR_WIDTH, Math.round(value)))
}

export function parseContextSidebarWidth(value: string) {
  const width = Number(value)
  if (!Number.isInteger(width)) return undefined
  if (width < MIN_CONTEXT_SIDEBAR_WIDTH || width > MAX_CONTEXT_SIDEBAR_WIDTH) return undefined
  return width
}

export function useConsoleUiSettings() {
  const ctx = useConfig()
  const [width, setWidth] = createSignal(String(DEFAULT_CONTEXT_SIDEBAR_WIDTH))
  const [style, setStyle] = createSignal<ConsoleDiffStyle>(DEFAULT_CONSOLE_DIFF_STYLE)
  const [dirty, setDirty] = createSignal(false)

  createEffect(() => {
    if (dirty()) return
    const config = ctx.data()?.effective.console
    setWidth(String(normalizeContextSidebarWidth(config?.context_sidebar_width)))
    setStyle(normalizeConsoleDiffStyle(config?.diff_style))
  })

  function save() {
    const value = parseContextSidebarWidth(width())
    if (value === undefined) {
      ctx.fail(`Enter a sidebar width between ${MIN_CONTEXT_SIDEBAR_WIDTH} and ${MAX_CONTEXT_SIDEBAR_WIDTH} pixels.`)
      return
    }
    ctx.patch({ console: { context_sidebar_width: value, diff_style: style() } })
    setWidth(String(value))
    setDirty(false)
  }

  function reset() {
    ctx.unset([
      ["console", "context_sidebar_width"],
      ["console", "diff_style"],
    ])
    setWidth(String(DEFAULT_CONTEXT_SIDEBAR_WIDTH))
    setStyle(DEFAULT_CONSOLE_DIFF_STYLE)
    setDirty(false)
  }

  return {
    ctx,
    width,
    setWidth: (value: string) => {
      setWidth(value)
      setDirty(true)
    },
    style,
    setStyle: (value: string) => {
      setStyle(normalizeConsoleDiffStyle(value))
      setDirty(true)
    },
    dirty,
    configured: () => {
      const config = ctx.data()?.effective.console
      return config?.context_sidebar_width !== undefined || config?.diff_style !== undefined
    },
    save,
    reset,
  }
}
