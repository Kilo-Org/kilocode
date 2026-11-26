import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect, FileSystem } from "effect"
import { Global } from "@opencode/util/global"
import type { SessionMessageInfo } from "@opencode/client"
import { kiloErrorDescription, kiloErrorTitle, parseKiloErrorCode } from "../../src/kilocode/kilo-errors"
import { createEventStream, createFetch, directory, json } from "../fixture/tui-client"
import { tmpdir } from "../fixture/fixture"
import { catalogModel } from "../mini/fixture/catalog"

const SIGNED_OUT_BODY = JSON.stringify({
  error: { code: "INVALID_TOKEN", message: "Your authentication token is invalid. Please sign in again." },
  error_type: "authentication_required",
})

describe("parseKiloErrorCode", () => {
  test("recognizes INVALID_TOKEN only on HTTP 401", () => {
    expect(parseKiloErrorCode({ status: 401, response: { body: SIGNED_OUT_BODY } })).toBe("INVALID_TOKEN")
    expect(parseKiloErrorCode({ status: 400, response: { body: SIGNED_OUT_BODY } })).toBeUndefined()
    expect(parseKiloErrorCode({ response: { body: SIGNED_OUT_BODY } })).toBeUndefined()
    expect(kiloErrorTitle("INVALID_TOKEN")).toBe("You've been signed out of Kilo")
    expect(kiloErrorDescription("INVALID_TOKEN")).toContain("Sign in again")
  })

  test("recognizes paid model and promotion codes and ignores malformed bodies", () => {
    expect(
      parseKiloErrorCode({ status: 401, response: { body: JSON.stringify({ error: { code: "PAID_MODEL_AUTH_REQUIRED" } }) } }),
    ).toBe("PAID_MODEL_AUTH_REQUIRED")
    expect(
      parseKiloErrorCode({ status: 429, response: { body: JSON.stringify({ code: "PROMOTION_MODEL_LIMIT_REACHED" }) } }),
    ).toBe("PROMOTION_MODEL_LIMIT_REACHED")
    expect(parseKiloErrorCode({ status: 401, response: { body: "not json {" } })).toBeUndefined()
    expect(parseKiloErrorCode(undefined)).toBeUndefined()
  })
})

async function renderSessionError(messages: SessionMessageInfo[], waitFor: (frame: string) => boolean) {
  await using state = await tmpdir()
  const setup = await createTestRenderer({ width: 112, height: 32, kittyKeyboard: true })
  await setup.renderer.setupTerminal()
  setup.renderer.start()
  const model = { providerID: "kilo", id: "kilo-auto/free" }
  const session = {
    id: "ses_signed_out_ui",
    title: "Signed out session",
    projectID: "proj_test",
    location: { directory },
    agent: "build",
    model,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 10 },
  }
  const calls = createFetch((url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: messages.toReversed(), cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    if (url.pathname === "/api/model") {
      return json({
        location: { directory },
        data: [catalogModel({ ...model, name: "Auto" })],
      })
    }
  }, createEventStream())
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: (request) => calls.fetch(request) })
  const { run } = await import("../../src/app")
  const task = Effect.runPromise(
    run({
      app: { name: "test", version: "test", channel: "test" },
      server: { endpoint: { url: server.url.toString() } },
      config: {
        get: async () => ({ animations: false, tabs: { enabled: false } }),
        update: async () => ({}),
      },
      packages: { prepare: async () => ({ directory: "" }) },
      args: { sessionID: session.id },
      terminalHandoff: async () => ({ renderer: setup.renderer, mode: "dark", complete: () => {} }),
      log: () => {},
    }).pipe(Effect.provide(Global.layerWith({ state: state.path })), Effect.provide(FileSystem.layerNoop({}))),
  )
  try {
    await setup.waitForFrame(waitFor, { maxPasses: 200 })
    await setup.waitForVisualIdle()
    return setup.captureCharFrame()
  } finally {
    setup.renderer.destroy()
    await task
    await server.stop()
  }
}

test("production TUI renders the signed-out block with /connect and kilo auth login hints on 401 INVALID_TOKEN", async () => {
  const frame = await renderSessionError(
    [
      { type: "user", id: "msg_user", text: "Hello", time: { created: 1 } },
      {
        type: "assistant",
        id: "msg_assistant",
        agent: "build",
        model: { providerID: "kilo", id: "kilo-auto/free" },
        content: [],
        error: {
          type: "provider.auth",
          message: "You've been signed out of Kilo.",
          status: 401,
          response: { body: SIGNED_OUT_BODY },
        },
        time: { created: 2, completed: 3 },
      },
    ],
    (text) => text.includes("You've been signed out of Kilo"),
  )
  expect(frame).toContain("You've been signed out of Kilo")
  expect(frame).toContain("Your Kilo session is no longer valid. Sign in again, then resend your message.")
  expect(frame).toContain("Run /connect or `kilo auth login` to connect to Kilo Gateway")
}, 30_000)

test("production TUI renders the signed-out block for an idle execution error on 401 INVALID_TOKEN", async () => {
  const frame = await renderSessionError(
    [
      { type: "user", id: "msg_user", text: "Hello", time: { created: 1 } },
      {
        type: "idle",
        id: "msg_idle",
        outcome: "failed",
        error: {
          type: "provider.auth",
          message: "You've been signed out of Kilo.",
          status: 401,
          response: { body: SIGNED_OUT_BODY },
        },
        time: { created: 2 },
      },
    ],
    (text) => text.includes("You've been signed out of Kilo"),
  )
  expect(frame).toContain("You've been signed out of Kilo")
  expect(frame).toContain("Run /connect or `kilo auth login` to connect to Kilo Gateway")
}, 30_000)

test("production TUI falls back to the generic error line for INVALID_TOKEN on non-401 status", async () => {
  const frame = await renderSessionError(
    [
      { type: "user", id: "msg_user", text: "Hello", time: { created: 1 } },
      {
        type: "assistant",
        id: "msg_assistant",
        agent: "build",
        model: { providerID: "kilo", id: "kilo-auto/free" },
        content: [],
        error: {
          type: "provider.invalid-request",
          message: "Bad request token",
          status: 400,
          response: { body: SIGNED_OUT_BODY },
        },
        time: { created: 2, completed: 3 },
      },
    ],
    (text) => text.includes("Error: Bad request token"),
  )
  expect(frame).toContain("Error: Bad request token")
  expect(frame).not.toContain("You've been signed out of Kilo")
}, 30_000)
