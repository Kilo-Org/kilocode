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

test("memoryRow tones Enabled by per-session activity evidence", () => {
  // Current main tones Enabled success only with per-session evidence. v2 has no
  // durable per-session marker seam; the host-reported 5s save pulse is the only
  // activity evidence, so Enabled without it stays muted.
  expect(memoryRow({ enabled: true, loading: false })).toEqual({ label: "Enabled", tone: "muted" })
  expect(memoryRow({ enabled: true, loading: false, active: false })).toEqual({ label: "Enabled", tone: "muted" })
  expect(memoryRow({ enabled: true, loading: false, active: true })).toEqual({ label: "Enabled", tone: "success" })
  expect(memoryRow({ enabled: false, loading: false, active: true })).toEqual({ label: "Disabled", tone: "muted" })
})
