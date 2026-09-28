import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { EventEmitter } from "node:events"
import { browserMessage, handleBrowserMessage } from "../../src/agent-manager/browser-message"
import { createBrowserLifecycle } from "../../src/agent-manager/browser-lifecycle"
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
  const protocol = Object.assign(new EventEmitter(), {
    send: async (method: string, params?: Record<string, unknown>) => {
      protocol.emit(method, params)
      return {}
    },
    detach: async () => undefined,
  })
  const page = Object.assign(new EventEmitter(), {
    url: () => "http://localhost:3000/",
    title: async () => "",
    screenshot: async () => Buffer.from("jpeg"),
    mainFrame: () => page,
    context: () => ({ newCDPSession: async () => protocol }),
    goto: async () => undefined,
    reload: async () => undefined,
    setViewportSize: async () => undefined,
    evaluate: async (_fn: unknown, opts?: { action: string; text?: string }) => {
      if (opts?.action) return { focused: true, text: opts.action === "paste" ? opts.text : "selection" }
      if (++attempts === 1) throw new Error("Execution context was destroyed")
      return { tag: "button", selector: "#save", text: "Save" }
    },
  })
  const broker = new BrowserBroker({
    log: () => {},
    network: async () => ({ active: true, authorize: () => undefined, close: async () => undefined }),
    launch: async () => ({
      newContext: async () => ({
        close: async () => undefined,
        newPage: async () => page,
      }),
      close: async () => undefined,
    }),
  })
  brokers.push(broker)
  const current = await broker.open(
    { projectId: "project", sessionId: "session", directory: "/fixture" },
    "http://localhost:3000/",
  )
  const context = { id: "project", root: "/fixture", peekState: () => undefined, sessions: () => [{ id: "session" }] }
  const contexts = {
    resolve: (id: string) => (id === "project" ? context : undefined),
    byDirectory: (directory: string) => (directory === "/fixture" ? context : undefined),
    active: () => context,
  } as unknown as ProjectContexts
  const host = { isTrusted: () => state.trusted, browserAutomation: () => state.enabled } as unknown as Host
  const dispatch = (message: AgentManagerInMessage, post: (message: AgentManagerOutMessage) => void) => {
    expect(handleBrowserMessage(message, { host, contexts, browser: broker, post, log: () => {} })).toBe(true)
  }
  const send = (message: AgentManagerInMessage) => {
    const result = Promise.withResolvers<AgentManagerOutMessage>()
    dispatch(message, result.resolve)
    return result.promise
  }
  return { send, dispatch, state, broker, current, host, contexts, protocol, page }
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
  test.each([true, false])("forwards a missing browser before an entry exists (system Chrome: %s)", async (system) => {
    const view = await fixture()
    const broker = new BrowserBroker({
      log: () => {},
      useSystemChrome: () => system,
      launch: async () => {
        throw new Error(
          system
            ? "Chromium distribution 'chrome' is not found at /missing/chrome"
            : "Executable doesn't exist at /missing/chromium",
        )
      },
    })
    brokers.push(broker)
    const result = Promise.withResolvers<AgentManagerOutMessage>()
    handleBrowserMessage(
      { type: "agentManager.browser.open", projectId: "project", sessionId: "session", url: "http://localhost:3000/" },
      { host: view.host, contexts: view.contexts, browser: broker, post: result.resolve, log: () => {} },
    )
    expect(await result.promise).toMatchObject({
      type: "agentManager.browserState",
      browserId: "",
      projectId: "project",
      sessionId: "session",
      status: "error",
      missing: system ? "chrome" : "chromium",
      error: expect.stringContaining("was not found"),
    })
    expect(broker.get("session", "project")).toBeUndefined()
  })

  test("suspends streams only for the current panel's lifecycle", async () => {
    const view = await fixture()
    const suspend = spyOn(view.broker, "suspend")
    const lifecycle = createBrowserLifecycle({
      browser: view.broker,
      host: view.host,
      contexts: () => view.contexts,
      post: () => {},
      openPanel: () => {},
      log: () => {},
    })
    const panel = () => {
      const events = new EventEmitter()
      return {
        visible: true,
        events,
        onDidChangeVisibility(callback: (visible: boolean) => void) {
          events.on("visible", callback)
          return { dispose: () => events.off("visible", callback) }
        },
        onDidDispose(callback: () => void) {
          events.on("close", callback)
          return { dispose: () => events.off("close", callback) }
        },
      }
    }
    const first = panel()
    lifecycle.attach(first)
    first.events.emit("visible", true)
    expect(suspend).not.toHaveBeenCalled()
    first.events.emit("visible", false)
    expect(suspend).toHaveBeenCalledTimes(1)
    const second = panel()
    lifecycle.attach(second)
    first.events.emit("visible", false)
    first.events.emit("close")
    expect(suspend).toHaveBeenCalledTimes(1)
    second.events.emit("visible", false)
    second.events.emit("close")
    expect(suspend).toHaveBeenCalledTimes(3)
    await lifecycle.dispose()
    suspend.mockClear()
    second.events.emit("visible", false)
    expect(suspend).not.toHaveBeenCalled()
    suspend.mockRestore()
  })

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

  test("preserves the active project's untitled preview when DevTools fail", async () => {
    const test = await fixture()
    await test.broker.open({ projectId: "other", sessionId: "session", directory: "/other" }, "http://localhost:3000/")
    expect(await test.send({ type: "agentManager.browser.devtools", sessionId: "session" })).toEqual({
      ...browserMessage(test.current),
      error: "Browser developer tools are unavailable for this browser session",
    })
    expect(test.broker.get("session", "project")?.error).toBeUndefined()
  })

  test("reports a rejected URL without discarding the existing preview", async () => {
    const view = await fixture()
    expect(
      await view.send({
        type: "agentManager.browser.open",
        projectId: "project",
        sessionId: "session",
        url: "http://example.com/",
      }),
    ).toEqual({ ...browserMessage(view.current), error: expect.stringContaining("HTTPS") })
    expect(view.broker.get("session", "project")?.error).toBeUndefined()
  })

  test.each(["copy", "cut"] as const)("finishes %s and the clipboard write before a queued paste", async (action) => {
    const view = await fixture()
    const identity = { browserId: view.current.browserId, navigation: view.current.navigation, revision: 1 }
    await view.broker.viewport("session", "project", identity.browserId, identity.navigation, {
      width: 400,
      height: 300,
      revision: 1,
      active: true,
    })
    const entered = Promise.withResolvers<void>()
    const selected = Promise.withResolvers<{ focused: boolean; text: string }>()
    const writing = Promise.withResolvers<void>()
    const written = Promise.withResolvers<void>()
    const pasted = Promise.withResolvers<string>()
    const events: string[] = []
    let clipboard = "old"
    spyOn(view.page, "evaluate").mockImplementation(async (_fn, opts) => {
      if (opts?.action === "paste") return { focused: true, text: opts.text }
      entered.resolve()
      return selected.promise
    })
    view.host.copyToClipboard = async (value) => {
      writing.resolve()
      await written.promise
      events.push("write")
      clipboard = value
    }
    view.host.readClipboard = async () => {
      events.push("read")
      return clipboard
    }
    view.protocol.on("Input.insertText", (event: { text: string }) => pasted.resolve(event.text))
    const message = {
      type: "agentManager.browser.interact",
      projectId: "project",
      sessionId: "session",
      identity,
    } as const
    try {
      view.dispatch({ ...message, event: { kind: "clipboard", action } }, () => {})
      await entered.promise
      view.dispatch({ ...message, event: { kind: "clipboard", action: "paste" } }, () => {})
      selected.resolve({ focused: true, text: "new" })
      await writing.promise
      expect(events).toEqual([])
      written.resolve()
      expect(await pasted.promise).toBe("new")
      expect(events).toEqual(["write", "read"])
    } finally {
      selected.resolve({ focused: true, text: "new" })
      written.resolve()
    }
  })

  test("does not write clipboard data after browser ownership is revoked", async () => {
    const view = await fixture()
    const identity = { browserId: view.current.browserId, navigation: view.current.navigation, revision: 1 }
    await view.broker.viewport("session", "project", identity.browserId, identity.navigation, {
      width: 400,
      height: 300,
      revision: 1,
      active: true,
    })
    const entered = Promise.withResolvers<void>()
    const selected = Promise.withResolvers<{ focused: boolean; text: string }>()
    spyOn(view.page, "evaluate").mockImplementation(async () => {
      entered.resolve()
      return selected.promise
    })
    const values: string[] = []
    const copying = view.broker.interact(
      "session",
      "project",
      identity,
      { kind: "clipboard", action: "copy" },
      undefined,
      (value) => {
        values.push(value)
      },
    )
    await entered.promise
    view.broker.bind(
      () => undefined,
      async () => false,
    )
    selected.resolve({ focused: true, text: "private selection" })
    expect(await copying).toBeUndefined()
    expect(values).toEqual([])
  })

  test("reserves paste ordering before the host clipboard read resolves", async () => {
    const view = await fixture()
    const identity = { browserId: view.current.browserId, navigation: view.current.navigation ?? 0, revision: 1 }
    await view.broker.viewport("session", "project", identity.browserId, identity.navigation, {
      width: 400,
      height: 300,
      revision: 1,
      active: true,
    })
    const entered = Promise.withResolvers<void>()
    const clipboard = Promise.withResolvers<string>()
    const done = Promise.withResolvers<void>()
    const values: string[] = []
    view.host.readClipboard = () => {
      entered.resolve()
      return clipboard.promise
    }
    view.protocol.on("Input.insertText", (event: { text: string }) => {
      values.push(event.text)
      if (event.text === "after") done.resolve()
    })
    const message = {
      type: "agentManager.browser.interact",
      projectId: "project",
      sessionId: "session",
      identity,
    } as const
    view.dispatch({ ...message, event: { kind: "clipboard", action: "paste" } }, () => {})
    await entered.promise
    view.dispatch({ ...message, event: { kind: "text", text: "after" } }, () => {})
    await Bun.sleep(0)
    expect(values).toEqual([])
    clipboard.resolve("pasted")
    await done.promise
    expect(values).toEqual(["pasted", "after"])
  })

  test("does not read the clipboard for stale stream identities", async () => {
    const view = await fixture()
    const viewport = { width: 400, height: 300, revision: 2, active: true }
    const identity = {
      browserId: view.current.browserId,
      navigation: view.current.navigation,
      revision: viewport.revision,
    }
    await view.broker.viewport("session", "project", identity.browserId, identity.navigation, viewport)
    const messages: AgentManagerOutMessage[] = []
    let reads = 0
    view.host.readClipboard = async () => {
      reads++
      return "clipboard text"
    }
    for (const stale of [
      { ...identity, browserId: "retired" },
      { ...identity, navigation: identity.navigation - 1 },
      { ...identity, revision: identity.revision - 1 },
    ]) {
      view.dispatch(
        {
          type: "agentManager.browser.interact",
          projectId: "project",
          sessionId: "session",
          identity: stale,
          event: { kind: "clipboard", action: "paste" },
        },
        (message) => messages.push(message),
      )
    }
    expect(reads).toBe(0)
    const pasted = Promise.withResolvers<unknown>()
    view.protocol.once("Input.insertText", pasted.resolve)
    view.dispatch(
      {
        type: "agentManager.browser.interact",
        projectId: "project",
        sessionId: "session",
        identity,
        event: { kind: "clipboard", action: "paste" },
      },
      (message) => messages.push(message),
    )
    expect(await pasted.promise).toEqual({ text: "clipboard text" })
    expect(reads).toBe(1)
    expect(messages).toEqual([])
  })

  test("preserves an untitled preview when native picker input fails", async () => {
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
    ).toEqual({ ...browserMessage(test.current), error: "Pointer target is unavailable" })
    expect(await test.send({ type: "agentManager.browser.input", projectId: "project", sessionId: "session" })).toEqual(
      { ...browserMessage(test.current), error: "Browser element coordinates are required." },
    )
    expect(test.broker.get("session", "project")?.error).toBeUndefined()
  })
})
