import { expect, test } from "bun:test"
import * as Log from "@opencode-ai/core/util/log"

Log.init({ print: false })

const { DEFAULT_THEMES, allThemes, addTheme, hasTheme, resolveTheme } = await import(
  "../../../src/cli/cmd/tui/context/theme"
)

test("addTheme writes into module theme store", () => {
  const name = `plugin-theme-${Date.now()}`
  expect(addTheme(name, DEFAULT_THEMES.opencode)).toBe(true)

  expect(allThemes()[name]).toBeDefined()
})

test("addTheme keeps first theme for duplicate names", () => {
  const name = `plugin-theme-keep-${Date.now()}`
  const one = structuredClone(DEFAULT_THEMES.opencode)
  const two = structuredClone(DEFAULT_THEMES.opencode)
  one.theme.primary = "#101010"
  two.theme.primary = "#fefefe"

  expect(addTheme(name, one)).toBe(true)
  expect(addTheme(name, two)).toBe(false)

  expect(allThemes()[name]).toBeDefined()
  expect(allThemes()[name]!.theme.primary).toBe("#101010")
})

test("addTheme ignores entries without a theme object", () => {
  const name = `plugin-theme-invalid-${Date.now()}`
  expect(addTheme(name, { defs: { a: "#ffffff" } })).toBe(false)
  expect(allThemes()[name]).toBeUndefined()
})

test("hasTheme checks theme presence", () => {
  const name = `plugin-theme-has-${Date.now()}`
  expect(hasTheme(name)).toBe(false)
  expect(addTheme(name, DEFAULT_THEMES.opencode)).toBe(true)
  expect(hasTheme(name)).toBe(true)
})

test("resolveTheme rejects circular color refs", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.defs = {
    ...item.defs,
    one: "two",
    two: "one",
  }
  item.theme.primary = "one"

  expect(() => resolveTheme(item, "dark")).toThrow("Circular color reference")
})

// kilocode_change start - support [r,g,b,a] tuple color values
test("resolveTheme resolves [r, g, b, a] tuple with alpha passthrough", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.theme.background = [10, 20, 30, 40]

  const resolved = resolveTheme(item, "dark")
  expect(resolved.background.toInts()).toEqual([10, 20, 30, 40])
})

test("resolveTheme resolves fully transparent [0, 0, 0, 0] tuple", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.theme.background = [0, 0, 0, 0]

  const resolved = resolveTheme(item, "dark")
  expect(resolved.background.toInts()[3]).toBe(0)
})

test("resolveTheme defaults [r, g, b] tuple to opaque alpha", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.theme.background = [10, 20, 30]

  const resolved = resolveTheme(item, "dark")
  expect(resolved.background.toInts()).toEqual([10, 20, 30, 255])
})

test("resolveTheme keeps 'none' background transparent", () => {
  const item = structuredClone(DEFAULT_THEMES.opencode)
  item.theme.background = "none"

  const resolved = resolveTheme(item, "dark")
  expect(resolved.background.toInts()[3]).toBe(0)
})

test("resolveTheme rejects malformed color tuples", () => {
  for (const bad of [[], [10], [10, 20], [10, 20, 30, 40, 50], [10, 20, "30"], [10, 20, 300], [10, 20, 30.5], [10, 20, -1]]) {
    const item = structuredClone(DEFAULT_THEMES.opencode)
    item.theme.background = bad as never
    expect(() => resolveTheme(item, "dark")).toThrow("Invalid color tuple")
  }
})
// kilocode_change end
