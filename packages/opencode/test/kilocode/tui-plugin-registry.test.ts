import { expect, test } from "bun:test"
import { internalTuiPlugins } from "@/plugin/tui/internal"

const kilo = [
  "internal:home-news",
  "internal:home-onboarding",
  "internal:kilo-attention",
  "internal:kilo-home-footer",
  "internal:kilo-permissions",
  "internal:kilo-sidebar-footer",
  "internal:kilo-sidebar-memory",
  "internal:kilo-memory-palette",
  "internal:kilo-sidebar-background-processes",
  "internal:kilo-sidebar-indexing",
  "internal:kilo-sidebar-pr",
  "internal:kilo-sidebar-usage",
  "internal:sandbox",
  "internal:remote",
  "internal:reload",
]

test("internal TUI registry preserves every Kilo plugin before upstream builtins", () => {
  const ids = internalTuiPlugins({ experimentalEventSystem: false, experimentalSessionSwitcher: false }).map(
    (plugin) => plugin.id,
  )

  expect(ids.slice(0, kilo.length)).toEqual(kilo)
  expect(new Set(ids).size).toBe(ids.length)
  expect(ids).toContain("internal:sidebar-context")
  expect(ids).toContain("diff-viewer")
})

test("experimental Kilo TUI plugins remain wired", () => {
  const ids = internalTuiPlugins({ experimentalEventSystem: true, experimentalSessionSwitcher: true }).map(
    (plugin) => plugin.id,
  )

  expect(ids).toContain("internal:session-v2-debug")
  expect(ids).toContain("internal:session-switcher")
})
