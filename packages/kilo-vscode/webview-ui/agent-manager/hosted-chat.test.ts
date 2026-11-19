import { expect, jest, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { createHostedChat } from "./hosted-chat-model"
import { createSessionPool } from "./cloud/session-pool"

const target = {
  scope: "first-account",
  providerID: "kilo-cloud",
  workspaceID: "ws_one",
  sessionID: "ses_shared",
} as const
const idle: KiloHostedRpc.Snapshot = {
  connection: "live",
  status: "idle",
  messages: [],
  permissions: [],
  questions: [],
}
const message = (id: string, text: string): KiloHostedRpc.Message => ({
  id,
  type: "user",
  text,
  time: { created: 1 },
})

/** The public client serializes the real relay requests. The test decides when a response is delivered or lost. */
function relay() {
  type Call = {
    url: URL
    signal: AbortSignal
    input: Record<string, unknown>
    respond: (output: unknown) => void
    deny: () => void
    fail: () => void
  }
  let stream!: ReadableStreamDefaultController<Call>
  const calls = new ReadableStream<Call>({
    start(controller) {
      stream = controller
    },
  }).getReader()
  const paths: string[] = []
  const client = OpenCode.make({
    baseUrl: "http://relay.invalid",
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        paths.push(url.pathname)
        const reply = Promise.withResolvers<Response>()
        stream.enqueue({
          url,
          signal: request.signal,
          input: (await request.json()).input,
          respond: (output) => reply.resolve(Response.json({ output })),
          deny: () =>
            reply.resolve(
              Response.json(
                { _tag: "RpcError", type: "HostedError", message: "Cloud session access was denied." },
                { status: 400 },
              ),
            ),
          fail: () => reply.reject(new Error("lost connection")),
        })
        return reply.promise
      },
      { preconnect: fetch.preconnect },
    ),
  })
  async function next(method: string, selection: KiloHostedRpc.Target = target) {
    const { value } = await calls.read()
    if (!value) throw new Error("Missing request")
    expect(value.url.pathname).toBe(`/api/rpc/kilocode.hosted/${method}`)
    expect(value.url.searchParams.get("location[directory]")).toBe("/project")
    if (method === "stageImage") expect(value.input.scope).toBe(selection.scope)
    else expect(value.input.target).toEqual(selection)
    return value
  }
  const chat = createHostedChat(client, "/project", target)
  async function open(snapshot: KiloHostedRpc.Snapshot) {
    chat.open()
    ;(await next("attach")).respond({ attachmentID: "lease" })
    ;(await next("read")).respond({ revision: 1, snapshot })
    return next("read")
  }
  return { chat, client, paths, next, open }
}

test("opens durable history passively, pages older messages, replaces partial text and detaches while busy", async () => {
  const r = relay()
  const saved = {
    ...idle,
    connection: "disconnected" as const,
    before: "cursor",
    messages: [message("current", "partial")],
  }
  const watch = await r.open(saved)
  expect(watch.input).toEqual({ target, attachmentID: "lease", revision: 1, incremental: true })
  expect(r.chat.messages()).toEqual(saved.messages)
  const earlier = r.chat.loadEarlier()
  const history = await r.next("history")
  expect(history.input.before).toBe("cursor")
  history.respond({ messages: [message("earlier", "saved")] })
  await earlier
  watch.respond({ revision: 2, snapshot: { ...idle, status: "busy", messages: [message("current", "complete")] } })
  const updated = await r.next("read")
  expect(updated.input.revision).toBe(2)
  expect(r.chat.messages()).toEqual([message("earlier", "saved"), message("current", "complete")])
  expect(r.chat.before()).toBeUndefined()
  expect(r.chat.busy()).toBe(true)
  r.chat.close()
  expect(updated.signal.aborted).toBe(true)
  expect((await r.next("detach")).input.attachmentID).toBe("lease")
  expect(r.paths.map((p) => p.split("/").pop())).toEqual(["attach", "read", "read", "history", "read", "detach"])
})

test("only sends plain Cloud prompts and keeps their ID and draft after an ambiguous network failure", async () => {
  const r = relay()
  await r.open({ ...idle, connection: "disconnected", status: "unknown" })
  r.chat.setDraft(" first prompt ")
  const send = r.chat.send()
  const projected = r.chat.messages()[0]
  expect(projected).toMatchObject({ type: "user", text: "first prompt", time: { created: expect.any(Number) } })
  expect(r.chat.queued()).toEqual([])
  expect(r.chat.sending()).toBe(projected.id)
  const first = await r.next("prompt")
  expect(first.input.messageID).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
  expect(first.input).toEqual({ target, attachmentID: "lease", messageID: projected.id, text: "first prompt" })
  first.fail()
  expect(await send).toBe(false)
  expect(r.chat.sending()).toBeUndefined()
  expect(r.chat.messages()).toEqual([])
  expect(r.chat.failure()).toBe("prompt")
  expect(r.chat.draft()).toBe(" first prompt ")
  const resend = r.chat.send()
  expect(r.chat.messages().map((m) => m.id)).toEqual([projected.id])
  const retry = await r.next("prompt")
  expect(retry.input).toEqual(first.input)
  r.chat.setDraft("next draft")
  retry.respond({})
  expect(await resend).toBe(true)
  expect(r.chat.draft()).toBe("next draft")
  r.chat.close()
})

test("acknowledged sends stay visible until their exact ID is echoed, even for identical drafts", async () => {
  const r = relay()
  const watch = await r.open(idle)
  r.chat.setDraft("again")
  const first = r.chat.send()
  const firstPrompt = await r.next("prompt")
  firstPrompt.respond({})
  expect(await first).toBe(true)
  const firstID = String(firstPrompt.input.messageID)
  expect(r.chat.messages().map((m) => m.id)).toEqual([firstID])

  r.chat.setDraft("again")
  const second = r.chat.send()
  const secondPrompt = await r.next("prompt")
  const secondID = String(secondPrompt.input.messageID)
  expect(secondID).not.toBe(firstID)
  secondPrompt.respond({})
  expect(await second).toBe(true)
  const other = message("msg_from_another_client", "again")
  watch.respond({ revision: 2, snapshot: { ...idle, messages: [other] } })
  const updated = await r.next("read")
  expect(r.chat.messages().map((m) => m.id)).toEqual([other.id, firstID, secondID])
  expect(r.chat.queued()).toEqual([])

  const canonical = message(firstID, "expanded on the server")
  updated.respond({ revision: 3, order: [other.id, firstID], snapshot: { ...idle, messages: [canonical] } })
  await r.next("read")
  expect(r.chat.messages()).toEqual([other, canonical, expect.objectContaining({ id: secondID, text: "again" })])
  r.chat.close()
  expect(r.chat.messages()).toEqual([])
})

test("a canonical echo wins over a lost prompt receipt", async () => {
  const r = relay()
  const watch = await r.open(idle)
  r.chat.setDraft("original")
  const send = r.chat.send()
  const prompt = await r.next("prompt")
  const canonical = message(String(prompt.input.messageID), "canonical")
  watch.respond({ revision: 2, snapshot: { ...idle, messages: [canonical] } })
  await r.next("read")
  expect(r.chat.messages()).toEqual([canonical])
  expect(await send).toBe(true)
  expect(r.chat.sending()).toBeUndefined()
  prompt.fail()
  expect(r.chat.failure()).toBeUndefined()
  expect(r.chat.draft()).toBe("")
  expect(r.chat.messages()).toEqual([canonical])
  r.chat.close()
})

test("the server queue confirms admission despite a lost receipt; only a successful drop removes its projection", async () => {
  const r = relay()
  const otherID = "msg_000000000001aaaaaaaaaaaaaa"
  const watch = await r.open({ ...idle, status: "busy", queued: [otherID] })
  r.chat.setDraft("next")
  const send = r.chat.send()
  const prompt = await r.next("prompt")
  const id = String(prompt.input.messageID)
  expect(r.chat.queued()).toEqual([otherID])
  watch.respond({ revision: 2, snapshot: { ...idle, status: "busy", queued: [otherID, id] } })
  await r.next("read")
  expect(r.chat.queued()).toEqual([otherID, id])
  prompt.fail()
  expect(await send).toBe(true)
  expect(r.chat.failure()).toBeUndefined()
  expect(r.chat.draft()).toBe("")
  expect(r.chat.messages().map((m) => m.id)).toEqual([id])

  const missed = r.chat.cancelQueued(id)
  ;(await r.next("cancelQueued")).respond({ dropped: false })
  await missed
  expect(r.chat.messages().map((m) => m.id)).toEqual([id])
  expect(r.chat.queued()).toEqual([otherID, id])
  const cancel = r.chat.cancelQueued(id)
  const drop = await r.next("cancelQueued")
  expect(drop.input.messageID).toBe(id)
  drop.respond({ dropped: true })
  await cancel
  expect(r.chat.messages()).toEqual([])
  expect(r.chat.queued()).toEqual([otherID])
  r.chat.close()
})

test("an image is a native transcript file before staging returns a handle", async () => {
  const r = relay()
  await r.open(idle)
  const image = {
    id: crypto.randomUUID(),
    kind: "image" as const,
    name: "sample.gif",
    uri: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
  }
  const send = r.chat.send(undefined, [image])
  const row = r.chat.messages()[0]
  expect(row).toMatchObject({
    type: "user",
    files: [{ name: image.name, mime: "image/gif", data: image.uri.split(",")[1], source: { type: "inline" } }],
  })
  const stage = await r.next("stageImage")
  expect(stage.input).toMatchObject({ messageID: row.id, image: { id: image.id, mime: "image/gif" } })
  const handle = crypto.randomUUID()
  stage.respond({ handle })
  const prompt = await r.next("prompt")
  expect(prompt.input).toMatchObject({ messageID: row.id, attachments: [handle] })
  prompt.respond({})
  expect(await send).toBe(true)
  expect(r.chat.messages()).toEqual([row])
  r.chat.close()
})

test("incremental reads preserve settled message identity; stop-and-send stops once before admission", async () => {
  const r = relay()
  const first = await r.open({ ...idle, status: "busy", messages: [message("settled", "hi"), message("live", "a")] })
  const original = r.chat.messages()[0]
  first.respond({
    revision: 2,
    order: ["settled", "live"],
    snapshot: { ...idle, status: "busy", messages: [message("live", "ab")] },
  })
  await r.next("read")
  expect(r.chat.messages()[0]).toBe(original)
  expect(r.chat.messages()[1]).toEqual(message("live", "ab"))
  r.chat.setDraft("follow-up")
  const send = r.chat.send(undefined, [], undefined, true)
  ;(await r.next("interrupt")).respond({})
  ;(await r.next("prompt")).respond({})
  expect(await send).toBe(true)
  r.chat.close()
})

test("replies only to active requests and interrupts only an explicitly selected busy Cloud session", async () => {
  const r = relay()
  await r.open({
    ...idle,
    status: "busy",
    permissions: [{ id: "permission", permission: "read", patterns: ["*.ts"] }],
    questions: [
      { id: "question", questions: [] },
      { id: "other", questions: [] },
    ],
  })
  r.chat.setDraft("not yet")
  expect(r.chat.canSend()).toBe(false)
  expect(r.chat.permission("stale", "once")).toBeUndefined()
  const answers = [["first"], ["second", "third"]]
  const answer = r.chat.question("question", answers)
  const question = await r.next("replyQuestion")
  expect(question.input).toMatchObject({ requestID: "question", answers, attachmentID: "lease" })
  question.respond({})
  await answer
  expect(r.chat.question("question", answers)).toBeUndefined()
  const dismiss = r.chat.question("other")
  ;(await r.next("rejectQuestion")).respond({})
  await dismiss
  const permit = r.chat.permission("permission", "once")
  const permission = await r.next("replyPermission")
  expect(permission.input).toMatchObject({ requestID: "permission", reply: "once", attachmentID: "lease" })
  permission.respond({})
  await permit
  const interrupt = r.chat.interrupt()
  ;(await r.next("interrupt")).respond({})
  await interrupt
  r.chat.close()
})

test("reattachment keeps the last transcript while offline and starts again without replaying a prompt", async () => {
  const r = relay()
  const lost = await r.open({ ...idle, messages: [message("old", "private")] })
  r.chat.setDraft("unsent")
  lost.fail()
  ;(await r.next("detach")).respond({})
  expect(r.chat.phase()).toBe("reconnecting")
  expect(r.chat.messages()).toEqual([message("old", "private")])
  r.chat.retry()
  ;(await r.next("attach")).respond({ attachmentID: "new" })
  const before = await r.next("read")
  expect(before.input).toEqual({ target, attachmentID: "new", incremental: true })
  before.respond({ revision: 0, snapshot: idle })
  await r.next("read")
  expect(r.chat.phase()).toBe("ready")
  expect(r.chat.draft()).toBe("unsent")
  r.chat.close()
})

test("revoking a live lease clears private pages and unmaterialized sends", async () => {
  const r = relay()
  try {
    const watch = await r.open({ ...idle, before: "older", messages: [message("latest", "private")] })
    const earlier = r.chat.loadEarlier()
    ;(await r.next("history")).respond({ messages: [message("first", "also private")] })
    await earlier
    expect(r.chat.messages()).toHaveLength(2)
    r.chat.setDraft("private draft")
    const send = r.chat.send()
    const prompt = await r.next("prompt")
    prompt.respond({})
    expect(await send).toBe(true)
    expect(r.chat.messages().map((m) => m.id)).toEqual(["first", "latest", prompt.input.messageID])
    watch.deny()
    ;(await r.next("detach")).respond({})
    expect(r.chat.messages()).toEqual([])
    expect(r.chat.phase()).toBe("reconnecting")
  } finally {
    r.chat.close()
  }
})

test("late attachment is detached under its original account even when the next account has the same session ID", async () => {
  const r = relay()
  r.chat.open()
  const old = await r.next("attach")
  r.chat.close()
  const other = { ...target, scope: "second-account" }
  const next = createHostedChat(r.client, "/project", other)
  next.open()
  const open = await r.next("attach", other)
  old.respond({ attachmentID: "stale" })
  const cleanup = await r.next("detach")
  expect(cleanup.input).toEqual({ target, attachmentID: "stale" })
  expect(cleanup.signal.aborted).toBe(false)
  open.respond({ attachmentID: "fresh" })
  const read = await r.next("read", other)
  expect(read.input.attachmentID).toBe("fresh")
  next.close()
})

test("switching back reuses verified messages and the same live read; background leases expire", async () => {
  jest.useFakeTimers()
  const r = relay()
  const pool = createSessionPool(r.client)
  try {
    const one = pool.acquire("/project", target)
    ;(await r.next("attach")).respond({ attachmentID: "one" })
    ;(await r.next("read")).respond({ revision: 1, snapshot: { ...idle, messages: [message("saved", "one")] } })
    const watch = await r.next("read")
    one.release()
    watch.respond({ revision: 2, snapshot: { ...idle, status: "retry", messages: [message("saved", "updated")] } })
    const live = await r.next("read")
    expect(pool.activity("/project", target)).toBe("retry")
    const revisit = pool.acquire("/project", target)
    jest.advanceTimersByTime(31_000)
    expect(revisit.chat.messages()).toEqual([message("saved", "updated")])
    expect(r.paths.filter((p) => p.endsWith("/attach"))).toHaveLength(1)
    expect(live.signal.aborted).toBe(false)
    revisit.release()
    jest.advanceTimersByTime(30_000)
    expect(live.signal.aborted).toBe(true)
    expect((await r.next("detach")).input.attachmentID).toBe("one")
    expect(one.chat.messages()).toEqual([])
  } finally {
    pool.clear()
    jest.useRealTimers()
  }
})

test("a fourth distinct account evicts the oldest model even with identical workspace and session IDs", async () => {
  const r = relay()
  const pool = createSessionPool(r.client)
  const watches: AbortSignal[] = []
  for (const scope of ["a", "b", "c"]) {
    const scoped = { ...target, scope }
    const lease = pool.acquire("/project", scoped)
    const attach = await r.next("attach", scoped)
    watches.push(attach.signal)
    lease.release()
  }
  pool.acquire("/project", target)
  expect(watches.map((w) => w.aborted)).toEqual([true, false, false])
  pool.clear("/unrelated")
  expect(watches[1]?.aborted).toBe(false)
  pool.clear("/project")
  expect(watches.every((w) => w.aborted)).toBe(true)
})
