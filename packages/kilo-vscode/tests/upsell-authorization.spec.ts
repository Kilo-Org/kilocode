import { expect, test, type Page } from "@playwright/test"
import { createRequire } from "node:module"
import type { SidebarUpsell as Host } from "../src/kilo-provider/upsell"
import type { WebviewMessage } from "../webview-ui/src/types/messages"

const require = createRequire(import.meta.url)
const { SidebarUpsell } = require("../src/kilo-provider/upsell") as typeof import("../src/kilo-provider/upsell")

type Request = Extract<WebviewMessage, { type: "agentManagerUpsell" }>
type Reply = Awaited<ReturnType<Host["handle"]>> & { type: "agentManagerUpsellLoaded"; request: string }
type Record = { action: Request["action"]; reply: Reply }
type Boundary = Window & {
  authorization: { held: boolean; queued: Record[]; delivered: Record[]; messages: WebviewMessage[] }
  authorize(message: Request): Promise<Omit<Reply, "type" | "request">>
  deliver(): void
}

async function received(page: Page, stage: "queued" | "delivered", action: Request["action"], count = 1) {
  await page.evaluate(
    async ({ stage, action, count }) => {
      const boundary = window as Boundary
      const done = Promise.withResolvers<void>()
      const receive = () => {
        if (boundary.authorization[stage].filter((record) => record.action === action).length < count) return
        window.removeEventListener("authorizationBoundary", receive)
        done.resolve()
      }
      window.addEventListener("authorizationBoundary", receive)
      receive()
      await done.promise
    },
    { stage, action, count },
  )
}

async function visible(page: Page, active: boolean) {
  await page.evaluate(
    (active) => window.dispatchEvent(new CustomEvent("upsellStoryChange", { detail: { active } })),
    active,
  )
}

async function attach(page: Page, delayed = false) {
  // Fake only the VS Code Memento boundary for completed, sequential updates.
  const values = new Map<string, unknown>()
  const global = {
    get: <T>(key: string, fallback: T) => structuredClone((values.get(key) as T | undefined) ?? fallback),
    update: async (key: string, value: unknown) => {
      values.set(key, structuredClone(value))
    },
  }
  const workspace = { get: <T>(_key: string, _fallback: T) => ["one", "two"] as T, update: async () => {} }
  const clock = { now: 10_000 }
  const host = new SidebarUpsell(global, workspace, () => clock.now)
  const other = new SidebarUpsell(global, workspace, () => clock.now)
  const scene = { active: true }
  const ack = { ready: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() }
  await page.exposeFunction("authorize", async (message: Request) => {
    if (message.action === "rendered" && delayed) {
      ack.ready.resolve()
      await ack.release.promise
    }
    return host.handle(message.action, scene.active)
  })
  await page.addInitScript(() => {
    const boundary = window as Boundary
    const post = window.postMessage.bind(window)
    const requests = new Map<string, Request["action"]>()
    const state: Boundary["authorization"] = { held: true, queued: [], delivered: [], messages: [] }
    const notify = () => window.dispatchEvent(new Event("authorizationBoundary"))
    Object.assign(window, {
      authorization: state,
      deliver: () => {
        const record = state.queued.shift()
        if (record) post(record.reply, window.location.origin)
      },
      acquireVsCodeApi: () => ({
        postMessage: async (message: WebviewMessage) => {
          state.messages.push(message)
          notify()
          if (message.type !== "agentManagerUpsell") return
          requests.set(message.request, message.action)
          const result = await boundary.authorize(message)
          const reply: Reply = { type: "agentManagerUpsellLoaded", request: message.request, ...result }
          if (state.held) state.queued.push({ action: message.action, reply })
          else post(reply, window.location.origin)
          notify()
        },
        getState: () => undefined,
        setState: () => {},
      }),
    })
    window.addEventListener("message", (event: MessageEvent<Reply>) => {
      if (event.data?.type !== "agentManagerUpsellLoaded") return
      state.delivered.push({ action: requests.get(event.data.request), reply: event.data })
      notify()
    })
    // Replace only the VS Code transport boundary, ignoring the story's local host replies.
    window.postMessage = (message: unknown, options?: string | WindowPostMessageOptions, transfer?: Transferable[]) => {
      if (message && typeof message === "object" && "type" in message && message.type === "agentManagerUpsellLoaded")
        return
      if (typeof options === "string") return post(message, options, transfer)
      post(message, options)
    }
  })
  await page.goto("/iframe.html?id=chat--chat-agent-manager-upsell&viewMode=story")
  await received(page, "queued", "shown")
  return { host, other, scene, ack, clock }
}

for (const key of ["active", "enabled"] as const) {
  for (const action of ["dont_show_again", "not_now"] as const) {
    test(`an unseen grant rereads completed Memento ${action} after ${key} resumes`, async ({ page }) => {
      const fixture = await attach(page)
      fixture.scene.active = key !== "active"
      await page.evaluate(
        (key) => window.dispatchEvent(new CustomEvent("upsellStoryChange", { detail: { [key]: false } })),
        key,
      )
      await page.evaluate(() => (window as Boundary).deliver())
      await received(page, "delivered", "shown")
      await expect(page.locator(".agent-manager-upsell")).toHaveCount(0)
      const result = await fixture.other.handle(action, true)
      expect(action === "dont_show_again" ? result.state.optedOut : result.state.snoozeCount).toBe(
        action === "dont_show_again" ? true : 1,
      )
      fixture.scene.active = true
      await page.evaluate(() => {
        ;(window as Boundary).authorization.held = false
      })
      await page.evaluate(
        (key) => window.dispatchEvent(new CustomEvent("upsellStoryChange", { detail: { [key]: true } })),
        key,
      )
      await received(page, "delivered", "shown", 2)
      await expect(page.locator(".agent-manager-upsell")).toHaveCount(0)
      const evidence = await page.evaluate(() => {
        const state = (window as Boundary).authorization
        return {
          denied: state.delivered.at(-1)?.reply.display,
          acks: state.messages.filter(
            (message) => message.type === "agentManagerUpsell" && message.action === "rendered",
          ).length,
          impressions: state.messages.filter(
            (message) => message.type === "telemetry" && message.properties?.["action"] === "shown",
          ).length,
        }
      })
      expect(evidence).toEqual({ denied: false, acks: 0, impressions: 0 })
      if (action === "dont_show_again") await fixture.other.handle("undo", true)
      if (action === "not_now") fixture.clock.now += 7 * 24 * 60 * 60 * 1000
      expect((await fixture.host.handle("shown", true)).display).toBe(true)
    })
  }
}

test("disabling and re-enabling cannot resurrect an impressed toast while its ACK is delayed", async ({ page }) => {
  const fixture = await attach(page, true)
  await page.evaluate(() => {
    ;(window as Boundary).authorization.held = false
    ;(window as Boundary).deliver()
  })
  await fixture.ack.ready.promise
  await expect(page.locator(".agent-manager-upsell")).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("upsellStoryChange", { detail: { enabled: false } })))
  await expect(page.locator(".agent-manager-upsell")).toHaveCount(0)
  await fixture.other.handle("dont_show_again", true)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("upsellStoryChange", { detail: { enabled: true } })))
  await expect(page.locator(".agent-manager-upsell")).toHaveCount(0)
  const messages = await page.evaluate(() => (window as Boundary).authorization.messages)
  expect(
    messages.filter((message) => message.type === "agentManagerUpsell" && message.action === "shown"),
  ).toHaveLength(1)
  expect(
    messages.filter((message) => message.type === "agentManagerUpsell" && message.action === "rendered"),
  ).toHaveLength(1)
  expect(
    messages.filter((message) => message.type === "telemetry" && message.properties?.["action"] === "shown"),
  ).toHaveLength(1)
  fixture.ack.release.resolve()
  await received(page, "delivered", "rendered")
})

for (const delayed of [false, true]) {
  test(`a valid render ACK ${delayed ? "after" : "before"} native hiding latches across same-host remount`, async ({
    page,
  }) => {
    const fixture = await attach(page, delayed)
    await page.evaluate(() => {
      ;(window as Boundary).authorization.held = false
      ;(window as Boundary).deliver()
    })
    if (delayed) await fixture.ack.ready.promise
    if (!delayed) await received(page, "delivered", "rendered")
    await expect(page.locator(".agent-manager-upsell")).toBeVisible()
    fixture.scene.active = false
    await visible(page, false)
    await expect(page.locator(".agent-manager-upsell")).toHaveCount(0)
    if (delayed) {
      fixture.ack.release.resolve()
      await received(page, "delivered", "rendered")
    }
    fixture.scene.active = true
    await page.reload()
    await received(page, "queued", "shown")
    expect(await page.evaluate(() => (window as Boundary).authorization.queued.at(0)?.reply.display)).toBe(false)
    await page.evaluate(() => (window as Boundary).deliver())
    await expect(page.locator(".agent-manager-upsell")).toHaveCount(0)
  })
}

test("a clipped unseen grant rereads completed Memento opt-out before resize exposes it", async ({ page }) => {
  const fixture = await attach(page)
  await page.setViewportSize({ width: 430, height: 1 })
  await page.evaluate(() => {
    ;(window as Boundary).authorization.held = false
    ;(window as Boundary).deliver()
  })
  const card = page.locator(".agent-manager-upsell")
  await expect(card).toHaveCount(1)
  await card.evaluate(async (node) => {
    const done = Promise.withResolvers<void>()
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.intersectionRatio < 0.01)) return
        observer.disconnect()
        done.resolve()
      },
      { threshold: 0.01 },
    )
    observer.observe(node)
    await done.promise
  })
  await fixture.other.handle("dont_show_again", true)
  await page.setViewportSize({ width: 430, height: 800 })
  await received(page, "delivered", "shown", 2)
  await expect(card).toHaveCount(0)
  const messages = await page.evaluate(() => (window as Boundary).authorization.messages)
  expect(messages.filter((message) => message.type === "agentManagerUpsell" && message.action === "rendered")).toEqual(
    [],
  )
  expect(
    messages.filter((message) => message.type === "telemetry" && message.properties?.["action"] === "shown"),
  ).toEqual([])
})
