import { InputRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

// The `/privacy` toggle through the `kilocode.settings` RPC. The fixture records every write so the tests assert the
// v1 sequence: enabling only sets the global key, and disabling also clears the project key from every project
// document. The privacy RPC drives the state, so the title and the next toggle follow it.
type Write = { scope: string; set?: Record<string, unknown>; unset?: string[][] }

async function launch(options: {
  enabled: boolean
  onWrite?: (input: Write, writes: readonly Write[]) => Response | undefined
}) {
  const writes: Write[] = []
  const privacy = { enabled: options.enabled }
  const app = await createAppFixture({
    fetch: async (url, request) => {
      if (url.pathname === "/api/rpc/kilocode.privacy/get") return json({ output: { enabled: privacy.enabled } })
      if (url.pathname === "/api/rpc/kilocode.settings/write") {
        const body = (await request.json()) as { input: Write }
        writes.push(body.input)
        const failure = options.onWrite?.(body.input, writes)
        if (failure) return failure
        if (typeof body.input.set?.privacy_mode === "boolean") privacy.enabled = body.input.set.privacy_mode
        return json({
          output: {
            scope: body.input.scope,
            target: { scope: body.input.scope, path: `${directory}/kilo2.json`, exists: true, revision: "rev" },
            changed: true,
          },
        })
      }
      return undefined
    },
  })
  await app.ready
  await app.waitForFrame((frame) => frame.includes("ctrl+p commands"))
  return Object.assign(app, { writes, privacy })
}

async function run(app: Awaited<ReturnType<typeof launch>>) {
  await app.mockInput.typeText("/privacy")
  await app.waitForFrame((frame) => frame.includes("Blur PII (balance, email, etc.)"))
  app.mockInput.pressEnter()
}

test("the command enables privacy mode by writing the global value", async () => {
  await using app = await launch({ enabled: false })
  await run(app)
  await app.waitForFrame((frame) => frame.includes("Privacy mode enabled"))
  expect(app.writes).toEqual([{ scope: "global", set: { privacy_mode: true } }])
  expect(app.privacy.enabled).toBe(true)
})

test("the command disables the global value and unsets the project value", async () => {
  await using app = await launch({ enabled: true })
  await run(app)
  await app.waitForFrame((frame) => frame.includes("Privacy mode disabled"))
  expect(app.writes).toEqual([
    { scope: "global", set: { privacy_mode: false } },
    { scope: "project", unset: [["privacy_mode"]] },
  ])
  expect(app.privacy.enabled).toBe(false)
})

test("the command title follows the current privacy state", async () => {
  await using app = await launch({ enabled: false })
  await app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("privacy mode")
  await app.waitForFrame((frame) => frame.includes("Enable privacy mode"))
})

test("the command title asks to disable while privacy mode is on", async () => {
  await using app = await launch({ enabled: true })
  await app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("privacy mode")
  await app.waitForFrame((frame) => frame.includes("Disable privacy mode"))
})

test("a failed write reports the RPC error and leaves the state unchanged", async () => {
  await using app = await launch({
    enabled: false,
    onWrite: () =>
      json({ _tag: "RpcError", type: "failed", message: "permission denied" }, { status: 400 }),
  })
  await run(app)
  await app.waitForFrame((frame) => frame.includes("Failed to update privacy mode (permission denied)"))
  expect(app.privacy.enabled).toBe(false)
  expect(app.writes).toHaveLength(1)
})

test("a conflict retries the write once and then succeeds", async () => {
  await using app = await launch({
    enabled: false,
    onWrite: (_input, writes) =>
      writes.length === 1
        ? json(
            { _tag: "RpcError", type: "conflict", message: "the target changed", data: { code: "revision-conflict", target: {} } },
            { status: 400 },
          )
        : undefined,
  })
  await run(app)
  await app.waitForFrame((frame) => frame.includes("Privacy mode enabled"))
  expect(app.writes).toEqual([
    { scope: "global", set: { privacy_mode: true } },
    { scope: "global", set: { privacy_mode: true } },
  ])
})
