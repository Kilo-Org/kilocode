import { expect, test } from "bun:test"
import { memoryRow } from "../src/tui-plugin/sidebar-memory"

test("memoryRow maps unknown state to Loading or Unavailable", () => {
  expect(memoryRow({ enabled: undefined, loading: true })).toEqual({ label: "Loading", tone: "muted" })
  expect(memoryRow({ enabled: undefined, loading: false })).toEqual({ label: "Unavailable", tone: "error" })
  expect(memoryRow({ enabled: undefined })).toEqual({ label: "Unavailable", tone: "error" })
})

test("memoryRow maps disabled memory to muted Disabled", () => {
  expect(memoryRow({ enabled: false, loading: false })).toEqual({ label: "Disabled", tone: "muted" })
  expect(memoryRow({ enabled: false, loading: true })).toEqual({ label: "Disabled", tone: "muted" })
})

test("memoryRow keeps Enabled neutral without a per-session activity seam", () => {
  // Current main tones Enabled success only with per-session evidence (durable
  // message markers or a 5s save pulse). No v2 source exposes that, so the row
  // must not claim activity: Enabled renders muted.
  expect(memoryRow({ enabled: true, loading: false })).toEqual({ label: "Enabled", tone: "muted" })
})
