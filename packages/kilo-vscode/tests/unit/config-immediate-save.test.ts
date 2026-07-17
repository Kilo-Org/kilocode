import { describe, expect, it } from "bun:test"
import path from "node:path"

const WEBVIEW = path.resolve(import.meta.dir, "../../webview-ui")
const PASS = "CONFIG_IMMEDIATE_SAVE_PASS"
const FAIL = "CONFIG_IMMEDIATE_SAVE_FAIL:"

const SCRIPT = `
  import { Window } from "happy-dom"

  const window = new Window()
  globalThis.window = window
  globalThis.document = window.document
  globalThis.Node = window.Node

  const sent = []
  globalThis.acquireVsCodeApi = () => ({
    postMessage: (message) => sent.push(message),
    getState: () => undefined,
    setState: () => {},
  })

  const { mock } = await import("bun:test")
  const { createComponent } = await import("solid-js")
  const { render } = await import("solid-js/web")
  const handlers = new Set()
  const vscode = {
    postMessage: (message) => sent.push(message),
    onMessage: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
  }
  mock.module("./src/context/vscode.tsx", () => ({ useVSCode: () => vscode }))
  const { ConfigProvider, useConfig } = await import("./src/context/config.tsx")

  let ctx
  const fail = (reason) => {
    console.log("${FAIL}" + reason)
    process.exit(2)
  }
  const Probe = () => {
    ctx = useConfig()
    return null
  }
  const target = (id) => ({
    id,
    scope: "global",
    target: { scope: "global", path: "/config/kilo.json", revision: id, exists: true, writable: true, raw: {} },
  })
  const update = (type, variant, binding, requestID) =>
    handlers.forEach((handler) => handler({
      type,
      config: { agent: { code: { variant } } },
      globalConfig: { agent: { code: { variant } } },
      bindings: { global: target(binding) },
      features: { indexing: false, sandboxControls: false },
      requestID,
    }))
  const failure = (variant, binding, requestID) =>
    handlers.forEach((handler) => handler({
      type: "configUpdateFailed",
      message: "write failed",
      config: { agent: { code: { variant } } },
      globalConfig: { agent: { code: { variant } } },
      bindings: { global: target(binding) },
      requestID,
    }))

  const root = document.createElement("div")
  const dispose = render(
    () => createComponent(ConfigProvider, {
      get children() {
        return createComponent(Probe, {})
      },
    }),
    root,
  )

  update("configLoaded", "low", "first")
  ctx.applyGlobalConfig({ agent: { code: { variant: "high" } } })
  if (ctx.config().agent?.code?.variant !== "high") fail("first selection was not optimistic")
  const writes = () => sent.filter((message) => message.type === "updateConfig")
  const first = writes()[0]?.requestID
  if (typeof first !== "string") fail("first selection did not include a request id")
  ctx.updateConfig({ snapshot: false })
  ctx.saveConfig()
  if (writes().length !== 1) fail("normal save overlapped an immediate selection")
  ctx.applyGlobalConfig({ agent: { code: { variant: "medium" } } })
  if (writes().length !== 1) fail("rapid selection did not coalesce")

  update("configUpdated", "low", "unrelated")
  if (ctx.config().agent?.code?.variant !== "medium") fail("unrelated update replaced the optimistic selection")
  if (writes().length !== 1) fail("unrelated update advanced the queue")

  update("configUpdated", "high", "second", first)
  if (ctx.config().agent?.code?.variant !== "medium") fail("queued selection was not retained")
  if (writes().length !== 2) fail("queued selection was not saved")
  if (writes()[1]?.globalBindingId !== "second") fail("queued selection did not use refreshed binding")
  if (writes()[1]?.config?.agent?.code?.variant !== "medium") fail("queued selection saved the wrong variant")

  const second = writes()[1]?.requestID
  if (typeof second !== "string") fail("queued selection did not include a request id")
  update("configUpdated", "medium", "third", second)
  ctx.applyGlobalConfig({ agent: { code: { variant: "high" } } })
  ctx.applyGlobalConfig({ agent: { code: { variant: "low" } } })
  const failed = writes()[2]?.requestID
  if (typeof failed !== "string") fail("failed selection did not include a request id")
  failure("medium", "fourth", failed)
  if (ctx.config().agent?.code?.variant !== "medium") fail("failed selection did not restore the authoritative variant")
  if (writes().length !== 3) fail("failed selection did not drop the queued variant")
  if (!ctx.saveError()) fail("failed selection did not surface an error")

  ctx.applyGlobalConfig({ agent: { code: { variant: "high" } } })
  const retry = writes()[3]?.requestID
  if (typeof retry !== "string") fail("retry did not include a request id")
  update("configUpdated", "high", "fifth", retry)
  if (ctx.saveError() !== null) fail("successful retry did not clear the failure")

  dispose()
  console.log("${PASS}")
`

describe("immediate global config saves", () => {
  it("optimistically applies and serializes rapid updates with refreshed bindings", () => {
    const result = Bun.spawnSync(["bun", "--conditions=browser", "-e", SCRIPT], {
      cwd: WEBVIEW,
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = result.stdout.toString() + result.stderr.toString()
    const start = output.indexOf(FAIL)

    if (start !== -1) {
      expect.unreachable(
        output
          .slice(start + FAIL.length)
          .split("\n")[0]
          ?.trim(),
      )
    }

    expect(result.exitCode, output).toBe(0)
    expect(output).toContain(PASS)
  })
})
