import { expect, test } from "bun:test"
import path from "node:path"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import { RGBA, TextAttributes } from "@opentui/core"
import { brandingPlugin } from "../src/branding/plugin"
import { KiloLogo } from "../src/branding/logo-art"
import { logo, go } from "../../tui/src/logo"
import { compileDefine } from "./fixtures/compile-define"
import { run, temporary } from "./fixtures/branding-run"

for (const hosted of [false, true]) {
  for (const modern of [false, true]) {
    test(`source logo layouts: ${hosted ? "Kilo" : "upstream"}, ${modern ? "modern" : "fallback"}`, async () => {
      await using root = await temporary()
      const fixture = path.join(import.meta.dir, "fixtures/logo-render.ts")
      checkLogos(await run([process.execPath, fixture, modern ? "1" : "0"], root.path, hosted), hosted, modern)
    }, 60_000)

    test(`compiled logo layouts: ${hosted ? "Kilo" : "upstream"}, ${modern ? "modern" : "fallback"}`, async () => {
      await using root = await temporary()
      const outfile = path.join(root.path, process.platform === "win32" ? "logo.exe" : "logo")
      const result = await Bun.build({
        entrypoints: [path.join(import.meta.dir, "fixtures/logo-render.ts")],
        plugins: [...(hosted ? [brandingPlugin] : []), createSolidTransformPlugin()],
        compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
        define: compileDefine,
      })
      expect(result.success, result.logs.map(String).join("\n")).toBe(true)
      checkLogos(await run([outfile, modern ? "1" : "0"], root.path, !hosted), hosted, modern)
    }, 60_000)
  }
}

function checkLogos(output: string, hosted: boolean, modern: boolean) {
  const result = JSON.parse(output) as {
    frames: {
      width: number
      height: number
      mode: "dark" | "light"
      frame: string
      spans: { text: string; fg: number[]; bg: number[]; attributes: number }[]
    }[]
    assets: { logo: typeof logo; go: typeof go; compact?: string[]; widths?: { split: number; full: number } }
  }
  const art = KiloLogo.art({ KILO_UNICODE_LOGO: modern ? "1" : "0" })
  expect(result.assets.go).toEqual(go)
  expect(result.assets.logo).toEqual(hosted ? art.logo : logo)
  expect(result.assets.compact).toEqual(hosted ? art.compact : undefined)
  expect(result.assets.widths).toEqual(hosted ? art.widths : undefined)
  expect(result.frames).toHaveLength(42)
  for (const { width, height, mode, frame, spans } of result.frames) {
    if (height < 12) {
      expect(frame.trim()).toBe("")
      continue
    }
    const compact = hosted ? art.compact : go.right.slice(1)
    const split = hosted ? [...art.logo.left, ...art.logo.right] : [...logo.left.slice(1), ...logo.right]
    const full = (hosted ? art.logo : logo).left.map(
      (line, index) => `${line} ${(hosted ? art.logo : logo).right[index]}`,
    )
    const rows =
      width < (hosted ? art.widths.split + 2 : 22)
        ? compact
        : width < (hosted ? art.widths.full + 4 : 44)
          ? split
          : full
    if (hosted) {
      const ink = RGBA.fromHex(mode === "light" ? "#736400" : "#FFDD00").toInts()
      expect(frame.match(/v2/g) ?? []).toHaveLength(rows === compact ? 0 : 1)
      const suffix = spans.find((span) => span.text.includes("v2"))
      if (rows !== compact) {
        expect(suffix?.fg).toEqual(ink)
        expect(suffix!.attributes & TextAttributes.BOLD).toBe(0)
        if (mode === "light") expect(contrast(suffix!.fg, suffix!.bg)).toBeGreaterThanOrEqual(4.5)
      }
      const strokes = spans.filter((span) => span.text.includes("█"))
      expect(strokes.length).toBeGreaterThan(0)
      for (const span of strokes) {
        expect(span.fg).toEqual(ink)
        expect(span.attributes & TextAttributes.BOLD).toBe(0)
        if (mode === "light") expect(contrast(span.fg, span.bg)).toBeGreaterThanOrEqual(4.5)
      }
      const shadows = spans.filter((span) => span.fg.some((value, index) => value !== ink[index]))
      expect(shadows.length > 0).toBe(rows !== compact)
      for (const span of shadows) {
        expect(span.text.trim()).toMatch(/^▀+$/)
        expect(span.fg).not.toEqual(ink)
        if (mode === "light") expect(contrast(span.fg, span.bg)).toBeGreaterThanOrEqual(3)
      }
    }
    for (const line of rows) {
      const visible = line.replaceAll("_", " ").replaceAll("^", "▀").replaceAll("~", "▀").replaceAll(",", "▄").trimEnd()
      if (visible.trim()) expect(frame).toContain(visible)
    }
    for (const line of frame.split("\n")) expect(Bun.stringWidth(line.trimEnd())).toBeLessThanOrEqual(width)
    if (hosted) expect(frame).not.toContain("█▀▀█ █▀▀█ █▀▀█ █▀▀▄")
  }
}

function contrast(foreground: number[], background: number[]) {
  const fg = luminance(foreground) + 0.05
  const bg = luminance(background) + 0.05
  return Math.max(fg, bg) / Math.min(fg, bg)
}

function luminance(rgb: number[]) {
  const linear = rgb.slice(0, 3).map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}
