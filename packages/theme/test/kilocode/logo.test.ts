import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { Schema } from "effect"
import { DEFAULT_THEME, ThemeDocument, resolveThemeDocument } from "../../src/tui/index.js"

test.each(["light", "dark"] as const)("built-in %s theme resolves text.logo to Kilo default", (mode) => {
  const theme = resolveThemeDocument(DEFAULT_THEME, mode)
  const expectedHex = mode === "dark" ? "#f9f76f" : "#6f6500"
  expect(theme.text.logo.equals(RGBA.fromHex(expectedHex))).toBeTrue()
})

test.each(["light", "dark"] as const)("custom %s theme honors explicit text.logo override", (mode) => {
  const explicitHex = resolveThemeDocument(
    Schema.decodeUnknownSync(ThemeDocument)({
      version: 2,
      [mode]: {
        text: { logo: "#ff00aa" },
      },
    }),
    mode,
  )
  expect(explicitHex.text.logo.equals(RGBA.fromHex("#ff00aa"))).toBeTrue()

  const variableRef = resolveThemeDocument(
    Schema.decodeUnknownSync(ThemeDocument)({
      version: 2,
      [mode]: {
        text: { logo: "$hue.yellow.400" },
      },
    }),
    mode,
  )
  expect(variableRef.text.logo.equals(variableRef.hue.yellow[400])).toBeTrue()
})

test.each(["light", "dark"] as const)(
  "omitted text.logo inherits default in normal themes and fallback in standalone themes",
  (mode) => {
    const normalInherited = resolveThemeDocument(
      Schema.decodeUnknownSync(ThemeDocument)({
        version: 2,
        [mode]: {
          text: { default: "#123456" },
        },
      }),
      mode,
    )
    const expectedDefault = mode === "dark" ? "#f9f76f" : "#6f6500"
    expect(normalInherited.text.logo.equals(RGBA.fromHex(expectedDefault))).toBeTrue()

    const standaloneOmitted = resolveThemeDocument(
      Schema.decodeUnknownSync(ThemeDocument)({
        version: 2,
        standalone: true,
        [mode]: {
          hue: DEFAULT_THEME[mode].hue,
          text: { default: "#123456" },
        },
      }),
      mode,
    )
    expect(standaloneOmitted.text.logo.equals(RGBA.fromHex(expectedDefault))).toBeTrue()

    const standaloneExplicit = resolveThemeDocument(
      Schema.decodeUnknownSync(ThemeDocument)({
        version: 2,
        standalone: true,
        [mode]: {
          hue: DEFAULT_THEME[mode].hue,
          text: { default: "#123456", logo: "#aabbcc" },
        },
      }),
      mode,
    )
    expect(standaloneExplicit.text.logo.equals(RGBA.fromHex("#aabbcc"))).toBeTrue()
  },
)

test.each(["light", "dark"] as const)(
  "contextual views inherit text.logo by default or honor context overrides",
  (mode) => {
    const theme = resolveThemeDocument(DEFAULT_THEME, mode)
    expect(theme.contextual.elevated.text.logo.equals(theme.text.logo)).toBeTrue()
    expect(theme.contextual.overlay.text.logo.equals(theme.text.logo)).toBeTrue()

    const contextual = resolveThemeDocument(
      Schema.decodeUnknownSync(ThemeDocument)({
        version: 2,
        [mode]: {
          text: { logo: "#112233" },
          "@context:elevated": {
            text: { logo: "#445566" },
          },
        },
      }),
      mode,
    )
    expect(contextual.text.logo.equals(RGBA.fromHex("#112233"))).toBeTrue()
    expect(contextual.contextual.elevated.text.logo.equals(RGBA.fromHex("#445566"))).toBeTrue()
    expect(contextual.contextual.overlay.text.logo.equals(RGBA.fromHex("#112233"))).toBeTrue()
  },
)

test.each(["light", "dark"] as const)("adding text.logo preserves all unrelated theme tokens in %s mode", (mode) => {
  const theme = resolveThemeDocument(DEFAULT_THEME, mode)

  expect(theme.text.default.equals(theme.hue.neutral[mode === "light" ? 800 : 200])).toBeTrue()
  expect(theme.text.subdued.equals(theme.hue.neutral[mode === "light" ? 600 : 400])).toBeTrue()
  expect(theme.text.status.running.equals(theme.hue.interactive[mode === "light" ? 800 : 200])).toBeTrue()
  expect(theme.text.status.unread.equals(theme.hue.accent[mode === "light" ? 800 : 200])).toBeTrue()
  expect(theme.text.feedback.error.default.equals(theme.hue.red[mode === "light" ? 700 : 300])).toBeTrue()

  expect(theme.background.default.equals(theme.hue.neutral[mode === "light" ? 200 : 800])).toBeTrue()
  expect(theme.border.default.equals(theme.hue.neutral[mode === "light" ? 300 : 700])).toBeTrue()
  expect(theme.scrollbar.default.equals(theme.hue.neutral[mode === "light" ? 400 : 600])).toBeTrue()
})
