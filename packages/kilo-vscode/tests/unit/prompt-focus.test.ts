import { describe, expect, it } from "bun:test"
import { createLatch, watchRestore } from "../../src/kilo-provider/prompt-focus"

function queue() {
  const pending: Array<() => void> = []
  return {
    defer: (fn: () => void) => pending.push(fn),
    flush: () => {
      for (const fn of pending.splice(0)) fn()
    },
  }
}

describe("createLatch", () => {
  it("restores after window focus when blur raced ahead of deactivation", () => {
    let focused = true
    const pending = queue()
    const latch = createLatch({ focused: () => focused, defer: pending.defer })
    latch.note(true)
    latch.note(false)
    focused = false
    latch.lock()
    pending.flush()
    focused = true
    expect(latch.restore()).toBe(true)
  })

  it("does not restore after the user left the webview while the window stayed focused", () => {
    let focused = true
    const pending = queue()
    const latch = createLatch({ focused: () => focused, defer: pending.defer })
    latch.note(true)
    latch.note(false)
    pending.flush()
    focused = false
    latch.lock()
    focused = true
    latch.unlock()
    expect(latch.restore()).toBe(false)
  })

  it("keeps the snapshot when the webview blurs during restore settlement", () => {
    let focused = true
    const pending = queue()
    const latch = createLatch({ focused: () => focused, defer: pending.defer })
    latch.note(true)
    focused = false
    latch.lock()
    focused = true
    latch.note(false)
    pending.flush()
    expect(latch.restore()).toBe(true)
  })

  it("adopts live blur after unlock", () => {
    let focused = true
    const pending = queue()
    const latch = createLatch({ focused: () => focused, defer: pending.defer })
    latch.note(true)
    latch.lock()
    latch.note(false)
    pending.flush()
    latch.unlock()
    expect(latch.restore()).toBe(false)
  })

  it("does not restore when an Agent Manager terminal had focus", () => {
    let focused = true
    const pending = queue()
    const latch = createLatch({ focused: () => focused, defer: pending.defer })
    latch.note(true)
    latch.mark("mainTerminal")
    latch.note(false)
    focused = false
    latch.lock()
    pending.flush()
    focused = true
    expect(latch.restore()).toBe(false)
  })

  it("restores a prompt-owned Agent Manager webview", () => {
    let focused = true
    const pending = queue()
    const latch = createLatch({ focused: () => focused, defer: pending.defer })
    latch.note(true)
    latch.mark("prompt")
    latch.note(false)
    focused = false
    latch.lock()
    pending.flush()
    focused = true
    expect(latch.restore()).toBe(true)
  })
})

describe("watchRestore", () => {
  it("does not restore immediately; waits for the webview to take focus", () => {
    let focused = true
    const pending = queue()
    const listeners: Array<(state: { focused: boolean }) => void> = []
    const restored: number[] = []
    const watch = watchRestore({
      focused: () => focused,
      onChange: (listener) => {
        listeners.push(listener)
        return { dispose: () => {} }
      },
      restore: () => restored.push(1),
      defer: pending.defer,
      wait: () => ({ dispose: () => {} }),
    })
    watch.note(true)
    focused = false
    listeners.at(0)?.({ focused: false })
    focused = true
    listeners.at(0)?.({ focused: true })
    expect(restored).toEqual([])
    watch.note(true)
    expect(restored).toEqual([])
  })

  it("falls back to revealing the host if the webview never reports focus", () => {
    let focused = true
    const listeners: Array<(state: { focused: boolean }) => void> = []
    const restored: number[] = []
    const waits: Array<() => void> = []
    watchRestore({
      focused: () => focused,
      onChange: (listener) => {
        listeners.push(listener)
        return { dispose: () => {} }
      },
      restore: () => restored.push(1),
      wait: (fn) => {
        waits.push(fn)
        return { dispose: () => {} }
      },
    }).note(true)
    focused = false
    listeners.at(0)?.({ focused: false })
    focused = true
    listeners.at(0)?.({ focused: true })
    expect(restored).toEqual([])
    waits.at(0)?.()
    expect(restored).toEqual([1])
  })

  it("still sends one restore after settlement if the webview already reported focus", () => {
    let focused = true
    const listeners: Array<(state: { focused: boolean }) => void> = []
    const restored: Array<{ live: boolean; prompt: boolean }> = []
    const waits: Array<() => void> = []
    const watch = watchRestore({
      focused: () => focused,
      onChange: (listener) => {
        listeners.push(listener)
        return { dispose: () => {} }
      },
      restore: (state) => restored.push(state),
      wait: (fn) => {
        waits.push(fn)
        return { dispose: () => {} }
      },
    })
    watch.note(true)
    focused = false
    listeners.at(0)?.({ focused: false })
    focused = true
    listeners.at(0)?.({ focused: true })
    watch.note(true)
    waits.at(0)?.()
    expect(restored).toEqual([{ live: true, prompt: false }])
  })

  it("restores prompt focus only when the prompt itself was held", () => {
    let focused = true
    const listeners: Array<(state: { focused: boolean }) => void> = []
    const restored: Array<{ live: boolean; prompt: boolean }> = []
    const waits: Array<() => void> = []
    const watch = watchRestore({
      focused: () => focused,
      onChange: (listener) => {
        listeners.push(listener)
        return { dispose: () => {} }
      },
      restore: (state) => restored.push(state),
      wait: (fn) => {
        waits.push(fn)
        return { dispose: () => {} }
      },
    })
    watch.note(true)
    watch.input(true)
    focused = false
    listeners.at(0)?.({ focused: false })
    focused = true
    listeners.at(0)?.({ focused: true })
    waits.at(0)?.()
    expect(restored).toEqual([{ live: true, prompt: true }])
  })

  it("skips restore when disabled", () => {
    let focused = true
    const listeners: Array<(state: { focused: boolean }) => void> = []
    const restored: number[] = []
    const watch = watchRestore({
      focused: () => focused,
      onChange: (listener) => {
        listeners.push(listener)
        return { dispose: () => {} }
      },
      restore: () => restored.push(1),
      enabled: () => false,
    })
    watch.note(true)
    focused = false
    listeners.at(0)?.({ focused: false })
    focused = true
    listeners.at(0)?.({ focused: true })
    expect(restored).toEqual([])
  })
})
