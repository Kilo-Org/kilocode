import { describe, expect, it } from "bun:test"
import { SidebarUpsell } from "../../src/kilo-provider/upsell"
import { eligible, type UpsellState } from "../../src/shared/agent-manager-upsell"
import { AGENT_MANAGER_UPSELL, sidebarTurns } from "../../webview-ui/src/components/chat/agent-manager-upsell"

const KEY = "upsell.agentManager"
const WEEK = 7 * 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 5)

// Updates become readable only after the persistence boundary completes.
class Storage {
  readonly values = new Map<string, unknown>()
  readonly writes: { key: string; value: unknown }[] = []
  private gate?: {
    entered: ReturnType<typeof Promise.withResolvers<void>>
    release: ReturnType<typeof Promise.withResolvers<void>>
  }

  get<T>(key: string, fallback: T): T {
    return structuredClone((this.values.get(key) as T | undefined) ?? fallback)
  }

  async update(key: string, value: unknown) {
    const entry = { key, value: structuredClone(value) }
    this.writes.push(entry)
    const gate = this.gate
    this.gate = undefined
    if (gate) {
      gate.entered.resolve()
      await gate.release.promise
    }
    this.values.set(key, entry.value)
  }

  hold() {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    this.gate = { entered, release }
    return { entered: entered.promise, release: release.resolve }
  }
}

function fixture(state: UpsellState = {}, ids = ["first", "second"]) {
  const global = new Storage()
  const workspace = new Storage()
  const clock = { now: NOW }
  global.values.set(KEY, state)
  workspace.values.set(`${KEY}.sessions`, ids)
  return { global, workspace, clock, host: new SidebarUpsell(global, workspace, () => clock.now) }
}

describe("Agent Manager upsell eligibility", () => {
  it("keeps the development gate disabled", () => {
    expect(AGENT_MANAGER_UPSELL).toBe(false)
  })

  it("allows a fresh profile and explicitly cleared suppression flags", () => {
    expect(eligible({}, NOW)).toBe(true)
    expect(eligible({ converted: false, opened: false, optedOut: false, snoozeCount: 0 }, NOW)).toBe(true)
  })

  it("waits seven full days, including when the recorded timestamp is zero", () => {
    expect(eligible({ snoozedAt: NOW, snoozeCount: 1 }, NOW + WEEK - 1)).toBe(false)
    expect(eligible({ snoozedAt: NOW, snoozeCount: 1 }, NOW + WEEK)).toBe(true)
    expect(eligible({ snoozedAt: NOW, snoozeCount: 1 }, NOW + WEEK + 1)).toBe(true)
    expect(eligible({ snoozedAt: 0 }, WEEK - 1)).toBe(false)
    expect(eligible({ snoozedAt: 0 }, WEEK)).toBe(true)
  })

  it("fails closed for a future snooze timestamp until seven days after that timestamp", () => {
    const state = { snoozedAt: NOW + WEEK, snoozeCount: 1 }
    expect(eligible(state, NOW)).toBe(false)
    expect(eligible(state, NOW + 2 * WEEK - 1)).toBe(false)
    expect(eligible(state, NOW + 2 * WEEK)).toBe(true)
  })

  it("permanently suppresses after the third snooze", () => {
    expect(eligible({ snoozeCount: 2, snoozedAt: NOW - WEEK }, NOW)).toBe(true)
    expect(eligible({ snoozeCount: 3, snoozedAt: NOW - 100 * WEEK }, NOW)).toBe(false)
    expect(eligible({ snoozeCount: 4 }, NOW)).toBe(false)
  })

  for (const state of [{ optedOut: true }, { converted: true }, { opened: true }]) {
    it(`suppresses ${Object.keys(state).at(0)} even after the snooze expires`, () => {
      expect(eligible({ ...state, snoozedAt: NOW - WEEK, snoozeCount: 1 }, NOW)).toBe(false)
    })
  }
})

describe("SidebarUpsell", () => {
  it("loads persisted state without claiming an impression or writing storage", async () => {
    const state = { snoozeCount: 1, snoozedAt: NOW - WEEK }
    const test = fixture(state)
    expect(await test.host.handle(undefined, true)).toEqual({ state, engaged: true, display: false })
    expect(test.global.writes).toEqual([])
    expect(test.workspace.writes).toEqual([])
    expect((await test.host.handle("shown", true)).display).toBe(true)
    expect(test.global.writes).toEqual([])
  })

  it("counts distinct sidebar starts, persists only two IDs, and reads them in a new host", async () => {
    const test = fixture({}, [])
    expect((await test.host.handle("shown", true)).display).toBe(false)
    await test.host.started("first")
    await test.host.started("first")
    expect(await test.host.handle("shown", true)).toEqual({ state: {}, engaged: false, display: false })
    await test.host.started("second")
    await test.host.started("third")
    expect(test.workspace.get<string[]>(`${KEY}.sessions`, [])).toEqual(["first", "second"])
    expect(test.workspace.writes).toEqual([
      { key: `${KEY}.sessions`, value: ["first"] },
      { key: `${KEY}.sessions`, value: ["first", "second"] },
    ])
    const host = new SidebarUpsell(test.global, test.workspace, () => NOW)
    expect((await host.handle("shown", true)).display).toBe(true)
  })

  it("serializes simultaneous starts across delayed workspace persistence", async () => {
    const test = fixture({}, [])
    const gate = test.workspace.hold()
    const first = test.host.started("first")
    await gate.entered
    const duplicate = test.host.started("first")
    const second = test.host.started("second")
    const third = test.host.started("third")
    const shown = test.host.handle("shown", true)
    expect(test.workspace.get<string[]>(`${KEY}.sessions`, [])).toEqual([])
    gate.release()
    await Promise.all([first, duplicate, second, third])
    expect(await shown).toEqual({ state: {}, engaged: true, display: true })
    expect(test.workspace.get<string[]>(`${KEY}.sessions`, [])).toEqual(["first", "second"])
    expect(test.workspace.writes).toHaveLength(2)
  })

  it("claims once per host window, survives webview reload requests, and resets in a new host", async () => {
    const test = fixture()
    const results = await Promise.all([test.host.handle("shown", true), test.host.handle("shown", true)])
    expect(results.map((result) => result.display)).toEqual([true, false])
    expect((await test.host.handle(undefined, true)).display).toBe(false)
    test.clock.now += WEEK
    expect((await test.host.handle("shown", true)).display).toBe(false)
    const host = new SidebarUpsell(test.global, test.workspace, () => test.clock.now)
    expect((await host.handle("shown", true)).display).toBe(true)
  })

  for (const action of [undefined, "shown", "opened", "not_now", "dont_show_again", "undo"] as const) {
    it(`ignores hidden ${action ?? "load"} without mutating state or claiming an impression`, async () => {
      const state = { snoozeCount: 1, snoozedAt: NOW - WEEK }
      const test = fixture(state)
      expect(await test.host.handle(action, false)).toEqual({ state, engaged: true, display: false })
      expect(test.global.get(KEY, {})).toEqual(state)
      expect(test.global.writes).toEqual([])
      expect((await test.host.handle("shown", true)).display).toBe(true)
    })
  }

  it("does not consume the window claim while snoozed or the timestamp is in the future", async () => {
    const test = fixture({ snoozedAt: NOW + WEEK, snoozeCount: 1 })
    expect((await test.host.handle("shown", true)).display).toBe(false)
    test.clock.now = NOW + 2 * WEEK - 1
    expect((await test.host.handle("shown", true)).display).toBe(false)
    test.clock.now += 1
    expect((await test.host.handle("shown", true)).display).toBe(true)
  })

  it("persists each snooze, permits a new host at exactly seven days, and caps snoozes at three", async () => {
    const test = fixture()
    for (const count of [1, 2, 3]) {
      const host = new SidebarUpsell(test.global, test.workspace, () => test.clock.now)
      expect((await host.handle("shown", true)).display).toBe(true)
      const result = await host.handle("not_now", true)
      expect(result).toEqual({
        state: { snoozedAt: test.clock.now, snoozeCount: count },
        engaged: true,
        display: false,
      })
      expect(test.global.get(KEY, {})).toEqual(result.state)
      test.clock.now += WEEK - 1
      const next = new SidebarUpsell(test.global, test.workspace, () => test.clock.now)
      expect((await next.handle("shown", true)).display).toBe(false)
      test.clock.now += 1
    }
    const host = new SidebarUpsell(test.global, test.workspace, () => test.clock.now)
    expect((await host.handle("shown", true)).display).toBe(false)
    expect((await host.handle("not_now", true)).state.snoozeCount).toBe(3)
    test.clock.now += 100 * WEEK
    expect(
      (await new SidebarUpsell(test.global, test.workspace, () => test.clock.now).handle("shown", true)).display,
    ).toBe(false)
  })

  it("persists opt-out across hosts and restores the current card on Undo without granting a second claim", async () => {
    const test = fixture()
    expect((await test.host.handle("shown", true)).display).toBe(true)
    expect(await test.host.handle("dont_show_again", true)).toEqual({
      state: { optedOut: true },
      engaged: true,
      display: false,
    })
    expect(test.global.get(KEY, {})).toEqual({ optedOut: true })
    const host = new SidebarUpsell(test.global, test.workspace, () => NOW)
    expect((await host.handle("shown", true)).display).toBe(false)
    expect(await test.host.handle("undo", true)).toEqual({
      state: { optedOut: false },
      engaged: true,
      display: true,
    })
    expect(test.global.get(KEY, {})).toEqual({ optedOut: false })
    expect((await test.host.handle("shown", true)).display).toBe(false)
    expect((await host.handle("shown", true)).display).toBe(true)
  })

  for (const action of ["opened", "command"] as const) {
    it(`persists ${action === "opened" ? "CTA conversion" : "opening Agent Manager outside the CTA"} across hosts and Undo`, async () => {
      const test = fixture({ snoozeCount: 1, snoozedAt: NOW - WEEK })
      if (action === "opened") await test.host.handle("opened", true)
      if (action === "command") await test.host.opened()
      const state = { snoozeCount: 1, snoozedAt: NOW - WEEK, [action === "opened" ? "converted" : "opened"]: true }
      expect(test.global.get(KEY, {})).toEqual(state)
      const host = new SidebarUpsell(test.global, test.workspace, () => NOW + 100 * WEEK)
      expect((await host.handle("shown", true)).display).toBe(false)
      expect(await host.handle("undo", true)).toEqual({
        state: { ...state, optedOut: false },
        engaged: true,
        display: false,
      })
    })
  }

  for (const state of [{ snoozedAt: NOW, snoozeCount: 1 }, { snoozeCount: 3 }]) {
    it(`Undo clears only opt-out, preserving ${state.snoozeCount === 3 ? "the lifetime cap" : "the active snooze"}`, async () => {
      const test = fixture({ ...state, optedOut: true })
      expect(await test.host.handle("undo", true)).toEqual({
        state: { ...state, optedOut: false },
        engaged: true,
        display: false,
      })
      expect(test.global.get(KEY, {})).toEqual({ ...state, optedOut: false })
      expect((await test.host.handle("shown", true)).display).toBe(false)
    })
  }

  for (const missing of ["global", "workspace", "both"] as const) {
    it(`fails closed on load and shown with missing ${missing} persistence`, async () => {
      const test = fixture()
      const host = new SidebarUpsell(
        missing === "workspace" ? test.global : undefined,
        missing === "global" ? test.workspace : undefined,
        () => NOW,
      )
      expect((await host.handle(undefined, true)).display).toBe(false)
      expect((await host.handle("shown", true)).display).toBe(false)
      expect(test.global.writes).toEqual([])
      expect(test.workspace.writes).toEqual([])
    })

    it(`fails closed on Undo with missing ${missing} persistence`, async () => {
      const test = fixture({ optedOut: true })
      const host = new SidebarUpsell(
        missing === "workspace" ? test.global : undefined,
        missing === "global" ? test.workspace : undefined,
        () => NOW,
      )
      expect((await host.handle("undo", true)).display).toBe(false)
    })
  }

  it("serializes Undo behind a delayed opt-out without losing existing state", async () => {
    const state = { snoozedAt: NOW - WEEK, snoozeCount: 2 }
    const test = fixture(state)
    expect((await test.host.handle("shown", true)).display).toBe(true)
    const gate = test.global.hold()
    const optout = test.host.handle("dont_show_again", true)
    await gate.entered
    const undo = test.host.handle("undo", true)
    const loaded = test.host.handle(undefined, true)
    expect(test.global.get(KEY, {})).toEqual(state)
    expect(test.global.writes).toHaveLength(1)
    gate.release()
    expect((await optout).state).toEqual({ ...state, optedOut: true })
    expect(await undo).toEqual({ state: { ...state, optedOut: false }, engaged: true, display: true })
    expect(await loaded).toEqual({ state: { ...state, optedOut: false }, engaged: true, display: false })
    expect(test.global.writes).toEqual([
      { key: KEY, value: { ...state, optedOut: true } },
      { key: KEY, value: { ...state, optedOut: false } },
    ])
    expect(test.global.get(KEY, {})).toEqual({ ...state, optedOut: false })
    expect((await test.host.handle("shown", true)).display).toBe(false)
  })

  it("serializes later snooze and opening behind delayed Undo persistence", async () => {
    const test = fixture({ optedOut: true, snoozeCount: 1 })
    const gate = test.global.hold()
    const undo = test.host.handle("undo", true)
    await gate.entered
    const snooze = test.host.handle("not_now", true)
    const opened = test.host.opened()
    const loaded = test.host.handle(undefined, true)
    expect(test.global.get(KEY, {})).toEqual({ optedOut: true, snoozeCount: 1 })
    expect(test.global.writes).toHaveLength(1)
    gate.release()
    expect((await undo).display).toBe(true)
    expect((await snooze).state).toEqual({ optedOut: false, snoozeCount: 2, snoozedAt: NOW })
    await opened
    const state = { optedOut: false, snoozeCount: 2, snoozedAt: NOW, opened: true }
    expect(await loaded).toEqual({ state, engaged: true, display: false })
    expect(test.global.get(KEY, {})).toEqual(state)
    expect(test.global.writes.map((entry) => entry.value)).toEqual([
      { optedOut: false, snoozeCount: 1 },
      { optedOut: false, snoozeCount: 2, snoozedAt: NOW },
      state,
    ])
  })
})

describe("sidebarTurns", () => {
  it("rejects restored completed summaries, including a fresh webview observing an old completion", () => {
    const observe = sidebarTurns()
    const state = { id: "session", turn: "turn", busy: false, reason: "completed", files: 1 }
    expect(observe(state)).toBe(false)
    expect(observe({ ...state, busy: true })).toBe(false)
    expect(observe(state)).toBe(true)
    expect(sidebarTurns()(state)).toBe(false)
  })

  it("requires both session and turn IDs before recording a running turn", () => {
    const observe = sidebarTurns()
    expect(observe({ turn: "turn", busy: true, files: 1 })).toBe(false)
    expect(observe({ id: "session", busy: true, files: 1 })).toBe(false)
    expect(observe({ id: "session", turn: "", busy: true, files: 1 })).toBe(false)
    expect(observe({ id: "session", turn: "turn", busy: false, reason: "completed", files: 1 })).toBe(false)
  })

  it("requires an observed active turn to finish successfully with diffs", () => {
    const observe = sidebarTurns()
    const state = { id: "session", turn: "turn", files: 1, reason: "completed" }
    expect(observe({ ...state, busy: true })).toBe(false)
    expect(observe({ ...state, busy: true })).toBe(false)
    expect(observe({ ...state, busy: false })).toBe(true)
    expect(observe({ ...state, busy: false })).toBe(true)
  })

  it("waits for a delayed close event after the idle status arrives", () => {
    const observe = sidebarTurns()
    const state = { id: "session", turn: "turn", files: 1 }
    expect(observe({ ...state, busy: true })).toBe(false)
    expect(observe({ ...state, busy: false })).toBe(false)
    expect(observe({ ...state, busy: false, reason: "completed" })).toBe(true)
    expect(observe({ ...state, busy: false, reason: "error" })).toBe(false)
  })

  for (const reason of ["interrupted", "error", "superseded"]) {
    it(`does not qualify ${reason ?? "missing"} completion or a later restored completed summary`, () => {
      const observe = sidebarTurns()
      const state = { id: "session", turn: "turn", files: 1 }
      expect(observe({ ...state, busy: true })).toBe(false)
      expect(observe({ ...state, busy: false, reason })).toBe(false)
      expect(observe({ ...state, busy: false, reason: "completed" })).toBe(false)
    })
  }

  it("does not transfer an observed run to an unobserved new turn", () => {
    const observe = sidebarTurns()
    expect(observe({ id: "session", turn: "old", busy: true })).toBe(false)
    expect(observe({ id: "session", turn: "new", busy: false, reason: "completed", files: 1 })).toBe(false)
    expect(observe({ id: "session", turn: "new", busy: true })).toBe(false)
    expect(observe({ id: "session", turn: "new", busy: false, reason: "completed", files: 1 })).toBe(true)
  })

  it("does not inherit completion when a new turn starts in the same session", () => {
    const observe = sidebarTurns()
    const state = { id: "session", busy: false, reason: "completed", files: 1 }
    expect(observe({ ...state, turn: "first", busy: true })).toBe(false)
    expect(observe({ ...state, turn: "first" })).toBe(true)
    expect(observe({ ...state, turn: "second", busy: true })).toBe(false)
    expect(observe({ ...state, turn: "second", reason: "interrupted" })).toBe(false)
  })

  for (const files of [undefined, 0]) {
    it(`waits for delayed diffs after completion with ${files ?? "missing"} files`, () => {
      const observe = sidebarTurns()
      const state = { id: "session", turn: "turn", reason: "completed" }
      expect(observe({ ...state, busy: true })).toBe(false)
      expect(observe({ ...state, busy: false, files })).toBe(false)
      expect(observe({ ...state, busy: false, files })).toBe(false)
      expect(observe({ ...state, busy: false, files: 2 })).toBe(true)
      expect(observe({ ...state, busy: false, files: 0 })).toBe(false)
    })
  }

  it("tracks active sessions independently while switching sidebar conversations", () => {
    const observe = sidebarTurns()
    const state = { reason: "completed", files: 1 }
    expect(observe({ ...state, id: "first", turn: "one", busy: true })).toBe(false)
    expect(observe({ ...state, id: "second", turn: "two", busy: false })).toBe(false)
    expect(observe({ ...state, id: "second", turn: "two", busy: true })).toBe(false)
    expect(observe({ ...state, id: "first", turn: "one", busy: false })).toBe(true)
    expect(observe({ ...state, id: "second", turn: "two", busy: false, reason: "interrupted" })).toBe(false)
    expect(observe({ ...state, id: "first", turn: "one", busy: false })).toBe(true)
  })
})
