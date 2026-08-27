import { afterEach, describe, expect, test } from "bun:test"
import { handleBrowserMessage } from "../../src/agent-manager/browser-message"
import type { Host } from "../../src/agent-manager/host"
import type { ProjectContexts } from "../../src/agent-manager/project/contexts"
import type { AgentManagerInMessage, AgentManagerOutMessage } from "../../src/agent-manager/types"
import { BrowserBroker } from "../../src/services/browser-automation/browser-broker"

const brokers: BrowserBroker[] = []

afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.disposeAsync()))
})

async function fixture() {
  let attempts = 0
  const state = { trusted: true, enabled: true }
  const page = {
    url: () => "http://localhost:3000/",
    title: async () => "Fixture",
    screenshot: async () => Buffer.from("jpeg"),
    on: () => undefined,
    mainFrame: () => undefined,
    goto: async () => undefined,
    setViewportSize: async () => undefined,
    evaluate: async () => {
      if (++attempts === 1) throw new Error("Execution context was destroyed")
      return { tag: "button", selector: "#save", text: "Save" }
    },
  }
  const broker = new BrowserBroker({
    log: () => {},
    launch: async () => ({
      newContext: async () => ({
        close: async () => undefined,
        route: async () => undefined,
        routeWebSocket: async () => undefined,
        newPage: async () => page,
      }),
      close: async () => undefined,
    }),
  })
  brokers.push(broker)
  await broker.open({ projectId: "project", sessionId: "session", directory: "/fixture" }, "http://localhost:3000/")
  const context = { id: "project", root: "/fixture", peekState: () => undefined, sessions: () => [{ id: "session" }] }
  const contexts = {
    resolve: (id: string) => (id === "project" ? context : undefined),
    active: () => context,
  } as unknown as ProjectContexts
  const host = { isTrusted: () => state.trusted, browserAutomation: () => state.enabled } as unknown as Host
  const send = (message: AgentManagerInMessage) =>
    new Promise<AgentManagerOutMessage>((resolve) => {
      expect(handleBrowserMessage(message, { host, contexts, browser: broker, post: resolve, log: () => {} })).toBe(
        true,
      )
    })
  return { send, state, broker }
}

const request = (id: string): AgentManagerInMessage => ({
  type: "agentManager.browser.inspect",
  projectId: "project",
  sessionId: "session",
  requestId: id,
  hover: true,
  x: 0.5,
  y: 0.5,
  width: 400,
  height: 300,
})

describe("browser inspection responses", () => {
  test("returns correlated failures and continues processing later hover requests", async () => {
    const test = await fixture()
    expect(await test.send(request("first"))).toEqual({
      type: "agentManager.browserInspection",
      projectId: "project",
      sessionId: "session",
      requestId: "first",
      hover: true,
      logs: [],
      error: "Execution context was destroyed",
    })
    expect(await test.send(request("second"))).toMatchObject({
      type: "agentManager.browserInspection",
      requestId: "second",
      hover: true,
      element: { selector: "#save" },
    })
  })

  test("correlates validation and permission failures instead of leaving the picker waiting", async () => {
    const test = await fixture()
    expect(
      await test.send({
        type: "agentManager.browser.inspect",
        projectId: "project",
        sessionId: "session",
        requestId: "invalid",
        hover: true,
      }),
    ).toMatchObject({ type: "agentManager.browserInspection", requestId: "invalid", error: expect.any(String) })
    test.state.trusted = false
    expect(await test.send(request("untrusted"))).toMatchObject({
      type: "agentManager.browserInspection",
      requestId: "untrusted",
      error: "Browser preview requires a trusted workspace.",
    })
    test.state.trusted = true
    test.state.enabled = false
    expect(await test.send(request("disabled"))).toMatchObject({
      type: "agentManager.browserInspection",
      requestId: "disabled",
      error: expect.any(String),
    })
  })

  test("surfaces native picker input failures instead of only logging them", async () => {
    const test = await fixture()
    test.broker.input = async () => {
      throw new Error("Pointer target is unavailable")
    }
    expect(
      await test.send({
        type: "agentManager.browser.input",
        projectId: "project",
        sessionId: "session",
        x: 0.5,
        y: 0.5,
        width: 400,
        height: 300,
        click: true,
      }),
    ).toMatchObject({ type: "agentManager.browserState", status: "error", error: "Pointer target is unavailable" })
  })
})
