import assert from "node:assert/strict"
import { jest, spyOn } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createPreferenceLoader } from "../../webview-ui/src/context/session-preference-loader"

function setup(online = true, loaded = false) {
  return createRoot((dispose) => {
    const [ready, hydrate] = createSignal(loaded)
    const [connected, connect] = createSignal(online)
    const sent: number[] = []
    const retry = createPreferenceLoader({ ready, connected, request: () => sent.push(Date.now()) })
    return { dispose, ready, hydrate, connect, sent, retry }
  })
}

jest.useFakeTimers()
const warning = spyOn(console, "warn").mockImplementation(() => undefined)

const cases: Record<string, () => void> = {
  exhaustion() {
    const state = setup()
    const start = Date.now()
    assert.deepEqual(state.sent, [start])
    jest.advanceTimersByTime(2999)
    assert.equal(state.sent.length, 1)
    jest.advanceTimersByTime(6001)
    assert.deepEqual(state.sent, [start, start + 3000, start + 6000, start + 9000])
    assert.equal(warning.mock.calls.length, 0, "the final request gets a response window")
    jest.advanceTimersByTime(3000)
    assert.equal(warning.mock.calls.length, 1)
    assert.match(String(warning.mock.calls.at(0)?.at(0)), /\[Kilo New\].*preferences.*4 attempts/)
    assert.equal(state.ready(), false, "exhaustion must not synthesize successful empty preferences")
    assert.equal(jest.getTimerCount(), 0)
    jest.advanceTimersByTime(60000)
    assert.equal(state.sent.length, 4)
    assert.equal(warning.mock.calls.length, 1)
    state.hydrate(true)
    assert.equal(state.ready(), true, "genuine late hydration remains authoritative")
    state.retry()
    assert.equal(state.sent.length, 4)
    state.dispose()
  },
  offline() {
    const state = setup(false)
    assert.equal(state.sent.length, 1, "request the host's cached disk path even while offline")
    assert.equal(jest.getTimerCount(), 0)
    jest.advanceTimersByTime(60000)
    assert.equal(state.sent.length, 1)
    assert.equal(warning.mock.calls.length, 0)
    state.retry()
    assert.equal(state.sent.length, 2, "extensionDataReady may also arrive before connected state")
    assert.equal(jest.getTimerCount(), 0)
    state.connect(true)
    assert.equal(state.sent.length, 3)
    assert.equal(jest.getTimerCount(), 1)
    jest.advanceTimersByTime(3000)
    assert.equal(state.sent.length, 4)
    state.dispose()
  },
  reconnect() {
    const state = setup()
    jest.advanceTimersByTime(3000)
    assert.equal(state.sent.length, 2)
    state.connect(false)
    assert.equal(jest.getTimerCount(), 0)
    jest.advanceTimersByTime(60000)
    assert.equal(state.sent.length, 2)
    assert.equal(warning.mock.calls.length, 0)
    state.connect(true)
    assert.equal(state.sent.length, 3)
    jest.advanceTimersByTime(12000)
    assert.equal(state.sent.length, 6)
    assert.equal(warning.mock.calls.length, 1)
    state.connect(true)
    assert.equal(jest.getTimerCount(), 0, "unchanged connection does not restart an exhausted cycle")
    state.connect(false)
    state.connect(true)
    assert.equal(state.sent.length, 7, "reconnect restarts even after exhaustion")
    jest.advanceTimersByTime(12000)
    assert.equal(state.sent.length, 10)
    assert.equal(warning.mock.calls.length, 2, "warn once per exhausted connection cycle")
    assert.equal(state.ready(), false)
    state.dispose()
  },
  retry() {
    const state = setup()
    jest.advanceTimersByTime(1000)
    state.retry()
    assert.equal(state.sent.length, 2)
    assert.equal(jest.getTimerCount(), 1, "extensionDataReady replaces, not duplicates, the timer")
    jest.advanceTimersByTime(2000)
    assert.equal(state.sent.length, 2, "the original timer was cancelled")
    jest.advanceTimersByTime(1000)
    assert.equal(state.sent.length, 3)
    jest.advanceTimersByTime(9000)
    assert.equal(state.sent.length, 5)
    assert.equal(warning.mock.calls.length, 1)
    state.retry()
    assert.equal(state.sent.length, 6, "extensionDataReady can recover an exhausted cycle")
    jest.advanceTimersByTime(12000)
    assert.equal(state.sent.length, 9)
    assert.equal(warning.mock.calls.length, 2)
    assert.equal(jest.getTimerCount(), 0)
    state.dispose()
  },
  ready() {
    const state = setup()
    jest.advanceTimersByTime(9000)
    state.hydrate(true)
    assert.equal(jest.getTimerCount(), 0, "readiness cancels the final response window")
    state.connect(false)
    state.connect(true)
    state.retry()
    jest.advanceTimersByTime(60000)
    assert.equal(state.sent.length, 4)
    assert.equal(warning.mock.calls.length, 0)
    state.dispose()
  },
  cleanup() {
    const state = setup()
    assert.equal(jest.getTimerCount(), 1)
    state.dispose()
    assert.equal(jest.getTimerCount(), 0)
    state.retry()
    state.connect(false)
    state.connect(true)
    jest.advanceTimersByTime(60000)
    assert.equal(state.sent.length, 1, "disposed owners cannot restart requests")
    assert.equal(warning.mock.calls.length, 0)
    assert.equal(state.ready(), false)
  },
  loaded() {
    const state = setup(false, true)
    state.connect(true)
    state.retry()
    assert.equal(state.sent.length, 0)
    assert.equal(jest.getTimerCount(), 0)
    state.dispose()
  },
  synchronous() {
    createRoot((dispose) => {
      const [ready, hydrate] = createSignal(false)
      let sent = 0
      const retry = createPreferenceLoader({
        ready,
        connected: () => true,
        request: () => {
          sent++
          hydrate(true)
        },
      })
      assert.equal(ready(), true)
      assert.equal(jest.getTimerCount(), 0, "a cached synchronous response does not leave a timer")
      retry()
      assert.equal(sent, 1)
      dispose()
    })
  },
}

try {
  const name = process.argv.at(2)
  assert.ok(name && cases[name], `Unknown preference loader case: ${name}`)
  cases[name]()
  assert.equal(jest.getTimerCount(), 0, "each case disposes all retry timers")
} finally {
  warning.mockRestore()
  jest.useRealTimers()
}
