import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { migrateV1, parseThemeDocument, resolveThemeDocument, themeModes } from "../../theme/src/tui"
import { KiloBranding } from "../src/branding/text"
import kilo from "../src/theme.json"

const document = parseThemeDocument(migrateV1(kilo), "kilo")

test("the single Kilo theme supports light and dark modes", () => {
  expect(themeModes(document)).toEqual(["light", "dark"])
})

for (const mode of ["light", "dark"] as const) {
  test(`resolves the existing Kilo ${mode} palette by semantic role`, () => {
    const theme = resolveThemeDocument(document, mode)
    const expected =
      mode === "dark"
        ? {
            background: "#0c0a09",
            panel: "#1c1917",
            element: "#292524",
            text: "#fafaf9",
            muted: "#a6a09b",
            primary: "#ffdd00",
            selected: "#0c0a09",
            error: "#ff6467",
            warning: "#cca700",
            success: "#89d185",
            info: "#3794ff",
            added: "#122318",
            removed: "#2a1214",
          }
        : {
            background: "#ffffff",
            panel: "#fafaf9",
            element: "#f5f5f4",
            text: "#0c0a09",
            muted: "#79716b",
            primary: "#736400",
            selected: "#ffffff",
            error: "#e7000b",
            warning: "#8a6d00",
            success: "#388a34",
            info: "#1a85ff",
            added: "#e8f5e9",
            removed: "#ffe4e6",
          }
    for (const [actual, color] of [
      [theme.background.base, expected.background],
      [theme.background.raised.base, expected.panel],
      [theme.background.raised.high, expected.element],
      [theme.text.base, expected.text],
      [theme.text.muted, expected.muted],
      [theme.text.formfield.focused, expected.primary],
      [theme.text.formfield.selected, expected.primary],
      [theme.background.action.primary.focused, expected.primary],
      [theme.text.action.primary.focused, expected.selected],
      [theme.text.feedback.error.base, expected.error],
      [theme.text.feedback.warning.base, expected.warning],
      [theme.text.feedback.success.base, expected.success],
      [theme.text.feedback.info.base, expected.info],
      [theme.syntax.keyword, expected.primary],
      [theme.syntax.string, expected.success],
      [theme.syntax.function, expected.info],
      [theme.markdown.heading, expected.primary],
      [theme.markdown.link, expected.primary],
      [theme.diff.text.added, expected.success],
      [theme.diff.text.removed, expected.error],
      [theme.diff.background.added, expected.added],
      [theme.diff.background.removed, expected.removed],
      [theme.surface("dialog").background.base, expected.panel],
    ] as const) {
      expect(actual.toInts()).toEqual(RGBA.fromHex(color).toInts())
    }
    expect(contrast(theme.text.base, theme.background.base)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(theme.text.formfield.selected, theme.background.base)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(theme.text.action.primary.focused, theme.background.action.primary.focused)).toBeGreaterThanOrEqual(
      4.5,
    )
    expect(contrast(theme.text.base, theme.surface("dialog").background.base)).toBeGreaterThanOrEqual(4.5)
  })
}

test("theme registration fails clearly when either upstream anchor changes", async () => {
  const file = "tui/src/theme/index.ts"
  const source = await Bun.file(new URL("../../tui/src/theme/index.ts", import.meta.url)).text()
  for (const [anchor] of KiloBranding.replacements[file]) {
    expect(() => KiloBranding.transform(file, source.replace(anchor, "changed"))).toThrow(
      "Kilo branding no longer matches tui/src/theme/index.ts",
    )
  }
  expect(KiloBranding.transform(file, source).indexOf("    kilo,")).toBeLessThan(
    KiloBranding.transform(file, source).indexOf("    ...customThemes,"),
  )
})

function contrast(first: RGBA, second: RGBA) {
  const luminance = (color: RGBA) => {
    const channels = [color.r, color.g, color.b].map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    )
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  }
  const values = [luminance(first), luminance(second)]
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05)
}
