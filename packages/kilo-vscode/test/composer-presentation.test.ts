import { afterEach, beforeEach, expect, jest, test } from "bun:test"
import type { PermissionRequest } from "@opencode/client"
import type {
  batch,
  createRoot,
  createSignal,
  createPermissionPresentation,
  createHintActivity,
} from "./fixtures/composer-presentation"

const bundle = await Bun.build({
  entrypoints: [`${import.meta.dir}/fixtures/composer-presentation.ts`],
  target: "browser",
})
const entry = bundle.outputs[0]
if (!entry) throw new Error("Missing composer presentation test bundle")
const source = Buffer.from(await entry.arrayBuffer()).toString("base64")
// SAFETY: The bundle is built from the typed fixture just above and preserves its exports.
const runtime = (await import(`data:text/javascript;base64,${source}`)) as {
  batch: typeof batch
  createRoot: typeof createRoot
  createSignal: typeof createSignal
  createPermissionPresentation: typeof createPermissionPresentation
  createHintActivity: typeof createHintActivity
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

function permissions(enabled = true) {
  return runtime.createRoot((dispose) => {
    const [session, setSession] = runtime.createSignal("ses_parent")
    const [requests, setRequests] = runtime.createSignal<PermissionRequest[]>([])
    const [autoApprove, setAutoApprove] = runtime.createSignal(enabled)
    return {
      show: runtime.createPermissionPresentation({ session, requests, autoApprove }),
      setRequests,
      setSession,
      setAutoApprove,
      [Symbol.dispose]: dispose,
    }
  })
}

const shell: PermissionRequest = { id: "per_1", sessionID: "ses_child", action: "shell", resources: ["pwd"] }

test("a fast auto-approval never shows a dock, but a request still pending after the grace period does", () => {
  using view = permissions()
  view.setRequests([shell])
  expect(view.show()).toBeUndefined()
  view.setRequests([])
  jest.runAllTimers()
  expect(view.show()).toBeUndefined()

  view.setRequests([shell])
  expect(view.show()).toBeUndefined()
  jest.advanceTimersToNextTimer()
  expect(view.show()).toEqual(shell)
  view.setRequests([])
  expect(view.show()).toBeUndefined()
})

test("manual requests appear immediately with auto-approve off or when turning it off mid-request", () => {
  using view = permissions(false)
  view.setRequests([shell])
  expect(view.show()).toEqual(shell)
  view.setAutoApprove(true)
  expect(view.show()).toEqual(shell)
  view.setRequests([{ ...shell, id: "per_2" }])
  expect(view.show()).toBeUndefined()
  view.setAutoApprove(false)
  expect(view.show()?.id).toBe("per_2")
})

const manualRequests: Partial<PermissionRequest>[] = [
  { action: "sandbox_escalation" },
  { action: "browser_sensitive" },
  { metadata: { sandboxEscalation: true } },
  { metadata: { browserSensitive: true } },
]
test.each(manualRequests)(
  "a request requiring a person (%j) is not delayed behind a subagent's auto-approval",
  (override) => {
    using view = permissions()
    const manual = { ...shell, ...override, id: "per_2", sessionID: "ses_parent" }
    view.setRequests([shell, manual])
    expect(view.show()).toEqual(manual)
  },
)

test("refreshing the same request does not restart its timer, but switching sessions does", () => {
  using view = permissions()
  view.setRequests([shell])
  jest.advanceTimersByTime(100)
  view.setRequests([{ ...shell }])
  jest.advanceTimersByTime(100)
  runtime.batch(() => {
    view.setSession("ses_child")
    view.setRequests([{ ...shell }])
  })
  jest.advanceTimersByTime(100)
  expect(view.show()).toBeUndefined()
  view.setRequests([{ ...shell }])
  jest.advanceTimersByTime(150)
  expect(view.show()).toEqual(shell)
})

test("a brief idle gap does not swap out the running shortcut, but a real finish does", () => {
  using view = runtime.createRoot((dispose) => {
    const [running, setRunning] = runtime.createSignal(true)
    return { activity: runtime.createHintActivity(running, () => undefined), setRunning, [Symbol.dispose]: dispose }
  })
  expect(view.activity.busy()).toBe(true)
  view.setRunning(false)
  expect(view.activity.busy()).toBe(true)
  view.setRunning(true)
  jest.runAllTimers()
  expect(view.activity.busy()).toBe(true)
  view.setRunning(false)
  jest.advanceTimersToNextTimer()
  expect(view.activity.busy()).toBe(false)
})

test("a brief background wait does not take over the hint; a lasting wait does and clears immediately", () => {
  using view = runtime.createRoot((dispose) => {
    const [waiting, setWaiting] = runtime.createSignal<number>()
    return { activity: runtime.createHintActivity(() => true, waiting), setWaiting, [Symbol.dispose]: dispose }
  })
  view.setWaiting(2)
  expect(view.activity.waiting()).toBeUndefined()
  view.setWaiting(undefined)
  jest.runAllTimers()
  expect(view.activity.waiting()).toBeUndefined()
  view.setWaiting(3)
  jest.advanceTimersToNextTimer()
  expect(view.activity.waiting()).toBe(3)
  view.setWaiting(undefined)
  expect(view.activity.waiting()).toBeUndefined()
})
