import { expect, test } from "bun:test"
import { KiloAccount } from "@kilocode/gateway-core"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { createAttachments, createWithImages } from "../src/hosted/attachments"
import { createCatalog } from "../src/hosted/catalog"

const signal = new AbortController().signal
const remote = "https://github.com/owner/repo"
const control = "workspace_10000000-1111-4111-8111-111111111111"
const target = { scope: "test", workspaceID: "worktree_1", sessionID: "ses_test", providerID: "kilo-cloud" } as const
const messageID = "msg_0123456789ab0123456789ABCD"
const agent = { mode: "code", model: "fixture" }
const envelope = (value: unknown) => Response.json({ result: { data: value } })
const image = {
  id: crypto.randomUUID(),
  mime: "image/png",
  base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8BAgMCAO+i2T8AAAAASUVORK5CYII=",
} as const

function fixture() {
  const account = KiloAccount.resolve({ token: "local-fixture" }, {})
  const paths: string[] = []
  const object = { key: "", path: "", file: `${crypto.randomUUID()}.png` }
  let rejectUpload = false
  let rejectSend = false
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (req.method === "PUT") {
        paths.push("put")
        expect(req.headers.get("authorization")).toBeNull()
        expect(req.headers.get("cookie")).toBeNull()
        expect(req.headers.get("content-type")).toBe(image.mime)
        expect(Buffer.from(await req.arrayBuffer()).toString("base64")).toBe(image.base64)
        return new Response(null, { status: rejectUpload ? 403 : 200 })
      }
      expect(req.headers.get("authorization")).toBe(`Bearer ${account.token}`)
      const method = url.pathname.split(".").at(-1)!
      paths.push(method)
      const body = await req.json()
      if (method === "getAttachmentUploadUrl") {
        expect(body.contentLength).toBe(Buffer.from(image.base64, "base64").length)
        expect(body.contentType).toBe(image.mime)
        object.path = body.messageUuid
        object.key = `user/cloud-agent/${object.path}/${object.file}`
        return envelope({
          key: object.key,
          signedUrl: `${url.origin}/objects/${object.key}?X-Amz-Signature=fixture`,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        })
      }
      if (method === "releasePendingUploads") {
        expect(body.objectKeys).toEqual([object.key])
        return envelope({ success: true })
      }
      if (method !== "sendMessage") throw Error("unexpected test request")
      expect(body).toEqual({
        cloudAgentSessionId: control,
        expectedWorktreeId: target.workspaceID,
        messageId: messageID,
        payload: { type: "prompt", prompt: "", ...agent },
        attachments: { path: object.path, files: [object.file] },
      })
      if (rejectSend) return new Response(null, { status: 503 })
      return envelope({ cloudAgentSessionId: control, messageId: messageID, status: "started", delivery: "queued" })
    },
  })
  return {
    server,
    paths,
    uploads: createAttachments(account, server.url.origin),
    rejectUpload: () => {
      rejectUpload = true
    },
    setRejectSend: (value: boolean) => {
      rejectSend = value
    },
  }
}

test("real PNG bytes are PUT without credentials, create is empty until a scoped linked image-only turn is sent, and retries reuse its IDs", async () => {
  const f = fixture()
  using server = f.server
  const { handle } = await f.uploads.stage(messageID, image, signal)
  expect(await f.uploads.stage(messageID, image, signal)).toEqual({ handle })
  let creates = 0
  const operationKey = crypto.randomUUID()
  const catalog = createCatalog(target.scope, remote, null, async (path, init) => {
    if (path === "/trpc/createHostedWorkspace") {
      creates++
      const input = JSON.parse(String(init.body))
      expect(input.operationKey).toBe(operationKey)
      expect(input.message).toBeUndefined()
      return envelope({ workspaceId: target.workspaceID, kiloSessionId: target.sessionID, replayed: creates > 1 })
    }
    expect(path.startsWith("/trpc/getHostedWorkspace?")).toBe(true)
    return envelope({
      workspaceId: target.workspaceID,
      name: "fixture",
      gitUrl: remote,
      gitBranch: "main",
      organizationId: null,
      deletionState: "active",
      nextSessionCursor: null,
      sessions: [
        {
          workspaceId: target.workspaceID,
          kiloSessionId: target.sessionID,
          cloudAgentSessionId: control,
          organizationId: null,
          title: null,
        },
      ],
    })
  })
  const create: KiloHostedRpc.Create = {
    scope: target.scope,
    operationKey,
    agent,
    messageID,
    prompt: "",
    attachments: [handle],
  }
  f.setRejectSend(true)
  await expect(createWithImages(create, catalog, f.uploads, signal)).rejects.toThrow("503")
  f.setRejectSend(false)
  expect(await createWithImages(create, catalog, f.uploads, signal)).toEqual({ target, replayed: true })
  await expect(f.uploads.verify("other-message", [handle])).rejects.toThrow()
  expect(f.paths).toEqual(["getAttachmentUploadUrl", "put", "sendMessage", "sendMessage"])
})

test("a refused PUT releases its pending object and cannot dispatch a message", async () => {
  const f = fixture()
  using server = f.server
  f.rejectUpload()
  await expect(f.uploads.stage(messageID, image, signal)).rejects.toThrow("Cloud image upload failed")
  expect(f.paths).toEqual(["getAttachmentUploadUrl", "put", "releasePendingUploads"])
})
