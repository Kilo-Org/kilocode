import { afterEach, describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { createSidebarScrollPreserver } from "../../webview-ui/agent-manager/sidebar-scroll"

const window = new Window()
const frames = new Map<number, FrameRequestCallback>()
let id = 0

function schedule(fn: FrameRequestCallback) {
  const next = ++id
  frames.set(next, fn)
  return next
}

function cancel(id: number) {
  frames.delete(id)
}

function preserver(active: () => string | null | undefined = () => undefined) {
  return createSidebarScrollPreserver(active, window.document, schedule, cancel)
}

afterEach(() => {
  window.document.body.innerHTML = ""
  frames.clear()
  id = 0
})

function list(cls = "am-worktree-list") {
  const el = window.document.createElement("div")
  el.className = cls
  Object.defineProperty(el, "scrollTop", { configurable: true, value: 0, writable: true })
  window.document.body.append(el)
  return el
}

function flush() {
  for (let i = 0; i < 2; i++) {
    const next = frames.entries().next().value
    if (!next) return
    frames.delete(next[0])
    next[1](0)
  }
}

describe("Agent Manager sidebar scroll preservation", () => {
  it("restores the scroll offset after the state update has rendered", () => {
    const el = list()
    el.scrollTop = 240
    const preserve = preserver()

    preserve(() => {
      el.scrollTop = 0
    })

    expect(el.scrollTop).toBe(0)
    flush()
    expect(el.scrollTop).toBe(240)
  })

  it("tracks project and worktree scroll owners independently", () => {
    const projects = list("am-projects-list")
    const worktrees = list()
    projects.scrollTop = 120
    worktrees.scrollTop = 80
    const preserve = preserver()

    preserve(() => {
      projects.scrollTop = 0
      worktrees.scrollTop = 0
    })
    flush()

    expect(projects.scrollTop).toBe(120)
    expect(worktrees.scrollTop).toBe(80)
  })

  it("does not override intentional selection scrolling", () => {
    const el = list()
    el.scrollTop = 240
    const preserve = preserver()

    preserve(() => {
      el.scrollTop = 140
    })
    flush()

    expect(el.scrollTop).toBe(140)
  })

  it("does not restore when the selected worktree changes during the update", () => {
    const el = list()
    let selected = "first"
    el.scrollTop = 240
    const preserve = preserver(() => selected)

    preserve(() => {
      el.scrollTop = 0
      selected = "second"
    })
    flush()

    expect(el.scrollTop).toBe(0)
  })

  it("does not restore when selection changes before the delayed frame", () => {
    const el = list()
    let selected = "first"
    el.scrollTop = 240
    const preserve = preserver(() => selected)

    preserve(() => {
      el.scrollTop = 0
    })
    selected = "second"
    flush()

    expect(el.scrollTop).toBe(0)
  })

  it("keeps intentional scrolling from the top of the list", () => {
    const el = list()
    const preserve = preserver()

    preserve(() => {
      el.scrollTop = 180
    })
    flush()

    expect(el.scrollTop).toBe(180)
  })

  it("cancels stale restores when a newer state arrives", () => {
    const el = list()
    const preserve = preserver()
    el.scrollTop = 120

    preserve(() => {
      el.scrollTop = 0
    })
    el.scrollTop = 210
    preserve(() => {
      el.scrollTop = 0
    })
    flush()

    expect(el.scrollTop).toBe(210)
    expect(frames.size).toBe(0)
  })

  it("does not restore a container that was removed by the update", () => {
    const el = list()
    el.scrollTop = 160
    const preserve = preserver()

    preserve(() => {
      el.remove()
      el.scrollTop = 0
    })
    flush()

    expect(el.isConnected).toBe(false)
    expect(el.scrollTop).toBe(0)
  })
})
