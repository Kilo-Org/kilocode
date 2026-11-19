import { expect, test } from "bun:test"
import { KiloAccount } from "@kilocode/gateway-core"
import { createPreview } from "../src/hosted/preview"

const target = {
  scope: "project",
  providerID: "kilo-cloud",
  workspaceID: "worktree_fixture",
  sessionID: "ses_fixture",
} as const
const signal = new AbortController().signal
const worker = "https://worker.invalid"
const open = `${worker}/preview/open?ticket=fixture.header.signature`
const now = () => Math.floor(Date.now() / 1000)

function fixture(org: string | null = null) {
  const calls: { method: string; procedure: string; input: unknown }[] = []
  const state = { authorize: true, enabled: true, url: open, expiresAt: now() + 60 }
  const account = { ...KiloAccount.resolve({ token: "fixture" }, {}), organizationID: org }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      calls.push({
        method: request.method,
        procedure: url.pathname.split("/").at(-1)!,
        input: request.method === "GET" ? JSON.parse(url.searchParams.get("input")!) : await request.json(),
      })
      const data =
        request.method === "GET"
          ? state.enabled
            ? { enabled: true, urlTemplate: "https://w-{port}.preview.invalid" }
            : { enabled: false }
          : { url: state.url, expiresAt: state.expiresAt }
      return Response.json({ result: { data } })
    },
  })
  const preview = createPreview(account, { issuer: server.url.origin, worker }, async (t) => {
    if (!state.authorize || t !== target) throw new Error("not in this workspace")
    return "unused-private-runtime-id"
  })
  return { calls, state, server, preview }
}

test.each([null, "11111111-1111-4111-8111-111111111111"])(
  "port preview uses scoped Cloud options and the correct personal/org mutation",
  async (org) => {
    const f = fixture(org)
    using _ = f.server
    const scoped = { worktreeId: target.workspaceID, ...(org && { organizationId: org }) }
    expect(await f.preview.options(target, signal)).toEqual({ enabled: true })
    expect(f.calls.map((c) => c.method)).toEqual(["GET"])
    expect((await f.preview.open(target, 3000, signal)).url === open).toBe(true)
    expect(f.calls.slice(1)).toEqual([
      { method: "GET", procedure: "cloudAgentNext.getPreviewOptions", input: scoped },
      {
        method: "POST",
        procedure: `${org ? "organizations." : ""}cloudAgentNext.createPreview`,
        input: { ...scoped, port: 3000 },
      },
    ])
  },
)

test("disabled deployment, invalid port or denied scope never mints a preview", async () => {
  const f = fixture()
  using _ = f.server
  await expect(f.preview.open(target, 1023, signal)).rejects.toThrow("port")
  f.state.authorize = false
  await expect(f.preview.open(target, 3000, signal)).rejects.toThrow("not in this workspace")
  expect(f.calls.length).toBe(0)
  f.state.authorize = true
  f.state.enabled = false
  await expect(f.preview.open(target, 3000, signal)).rejects.toThrow("unavailable")
  expect(f.calls.map((c) => c.method)).toEqual(["GET"])
})

test("a sandbox link preserves its exact same-origin path through the signed preview hop", async () => {
  const f = fixture()
  using _ = f.server
  const path = "/app?q=one#result"
  const hop = new URL(open)
  hop.searchParams.set("path", path)
  f.state.url = hop.href
  expect(await f.preview.open(target, 8192, signal, path)).toEqual({ url: hop.href })
  await expect(f.preview.open(target, 8192, signal, "/different")).rejects.toThrow("invalid response")
  await expect(f.preview.open(target, 8192, signal, "//other.invalid")).rejects.toThrow("Invalid preview path")
})

test("rejects an expired grant and any open URL other than the exact worker ticket hop", async () => {
  const f = fixture()
  using _ = f.server
  for (const bad of [
    open.replace("worker.invalid", "worker.invalid.other"),
    open.replace("https:", "http:"),
    open.replace("/preview/open", "/elsewhere"),
    `${open}&next=redirect`,
    `${open}#fragment`,
    open.replace("worker.invalid", "user@worker.invalid"),
  ]) {
    f.state.url = bad
    await expect(f.preview.open(target, 65535, signal)).rejects.toThrow("invalid response")
  }
  f.state.url = open
  f.state.expiresAt = now() - 1
  await expect(f.preview.open(target, 1024, signal)).rejects.toThrow("invalid response")
})
