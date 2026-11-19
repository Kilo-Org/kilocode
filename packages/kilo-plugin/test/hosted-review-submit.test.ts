import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { KiloAccount } from "@kilocode/gateway-core"
import { createReview } from "../src/hosted/review"
import { createReviewSubmit } from "../src/hosted/review-submit"

const signal = new AbortController().signal,
  remote = "worktree_fixture"
const target = { scope: "bound", providerID: "kilo-cloud", workspaceID: remote, sessionID: "source" } as const
const comparison = { baseRef: "main", mergeBase: "a".repeat(40), head: "b".repeat(40) }
const patch = "@@ -1,2 +1,2 @@\n context\r\n-old\n+new\n\\ No newline at end of file\n"
const comment = {
  id: crypto.randomUUID(),
  path: "example.ts",
  scope: "uncommitted" as const,
  revision: 4,
  comparison: { ...comparison },
  patchHash: createHash("sha256").update(patch).digest("hex"),
  side: "additions" as const,
  start: 1,
  end: 2,
  text: "Use a clearer name.",
}
const input = {
  target,
  destinationID: "destination",
  messageID: "msg_000000000001aaaaaaaaaaaaaa",
  draft: { comments: [comment], overall: "Summary" },
}
const reply = (data: unknown) => Response.json({ result: { data } })

function fixture(org: string | null) {
  const calls: { path: string; method: string; input: Record<string, unknown> }[] = []
  const state = {
    patch,
    revision: 4,
    head: comparison.head,
    destinationPayer: org,
    destinationOrigin: "cloud-agent-web",
    destinationWorkspace: remote,
    deny: false,
    reply: 200,
    receipt: null as unknown,
    wrongAck: false,
  }
  const row = (id: string) => ({
    session_id: id,
    title: id,
    organization_id: id === "source" ? org : state.destinationPayer,
    created_on_platform: id === "source" ? "cloud-agent-web" : state.destinationOrigin,
    parent_session_id: null,
    cloud_agent_worktree_id: id === "source" ? remote : state.destinationWorkspace,
    cloud_agent_session_id: `workspace_${id}`,
  })
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url),
        path = url.pathname.split("/").at(-1)!,
        body = req.method === "POST" ? await req.json() : JSON.parse(url.searchParams.get("input")!)
      calls.push({ path, method: req.method, input: body })
      if (path === "cliSessionsV2.list")
        return reply({
          cliSessions: [row("source"), row("destination"), { ...row("child"), parent_session_id: "source" }],
        })
      if (path === "cliSessionsV2.getWithRuntimeState") {
        const r = row(body.session_id)
        return reply({
          ...r,
          runtimeState: {
            sessionId: r.cloud_agent_session_id,
            kiloSessionId: r.session_id,
            userId: "fixture-owner",
            orgId: org ?? undefined,
            model: "other",
            mode: "reviewer",
            runtimeAgents: [{ slug: "reviewer", model: "pinned/model", variant: "high" }],
          },
        })
      }
      if (path.endsWith(".sendMessage"))
        return state.reply !== 200
          ? new Response(null, { status: state.reply })
          : reply({
              cloudAgentSessionId: state.wrongAck ? "wrong" : "workspace_destination",
              messageId: input.messageID,
              delivery: "sent",
            })
      if (path.endsWith(".getMessageResult")) return reply(state.receipt)
      return new Response(null, { status: 404 })
    },
  })
  const catalog = {
    async authorize(t: typeof target | { sessionID: string; workspaceID: string }) {
      if (state.deny || t.workspaceID !== remote || !["source", "destination"].includes(t.sessionID))
        throw Error("not authorized")
      return `workspace_${t.sessionID}`
    },
    async workspace() {
      return {
        workspaceID: remote,
        sessions: [{ sessionID: "source" }, { sessionID: "destination" }],
        deletionState: "active" as const,
      }
    },
  }
  const selection = { path: comment.path, scope: comment.scope, revision: 4 }
  const review = createReview(catalog.authorize, async (path) => {
    if (path.startsWith("/trpc/getWorktreeChanges?"))
      return reply({
        snapshot: {
          capturedAt: "2026-11-02T12:00:00Z",
          comparison: { ...comparison, head: state.head },
          revision: 9,
          truncated: false,
          files: [
            {
              ...selection,
              revision: state.revision,
              status: "modified",
              additions: 1,
              deletions: 1,
              binary: false,
              countsComplete: true,
            },
          ],
        },
      })
    if (path.startsWith("/trpc/getWorktreeFile?"))
      return reply({
        status: "available",
        file: {
          ...selection,
          diff: { status: "available", patch: state.patch },
          content: { status: "available", source: "current", text: "unused" },
        },
      })
    throw Error("unexpected worker route")
  })
  return {
    server,
    state,
    calls,
    submit: createReviewSubmit(
      { ...KiloAccount.resolve({ token: "fixture" }, {}), organizationID: org },
      server.url.origin,
      catalog,
      review,
    ),
  }
}

test.each([null, "11111111-1111-4111-8111-111111111111"])(
  "sends exact saved lines as one web-compatible review to the explicitly selected scoped chat",
  async (org) => {
    const f = fixture(org)
    using _ = f.server
    expect((await f.submit.destinations(target, signal)).items.map((i) => i.sessionID)).toEqual([
      "source",
      "destination",
    ])
    expect(await f.submit.send(input, signal)).toEqual({ status: "accepted" })
    const sends = f.calls.filter((c) => c.method === "POST")
    expect(sends).toHaveLength(1)
    expect(sends[0]).toMatchObject({
      path: `${org ? "organizations." : ""}cloudAgentNext.sendMessage`,
      input: {
        expectedWorktreeId: remote,
        autoCommit: true,
        cloudAgentSessionId: "workspace_destination",
        messageId: input.messageID,
        payload: { type: "prompt", mode: "reviewer", model: "pinned/model", variant: "high" },
        ...(org && { organizationId: org }),
      },
    })
    const prompt = (sends[0]!.input.payload as { prompt: string }).prompt
    expect(prompt.startsWith("Please address the following worktree review feedback as one review.")).toBe(true)
    expect(JSON.parse(prompt.slice(prompt.indexOf("\n\n") + 2))).toMatchObject({
      version: 1,
      overall: "Summary",
      comments: [
        {
          contextStatus: "current-saved-capture",
          text: comment.text,
          anchor: {
            capture: {
              userId: "fixture-owner",
              sourceCloudAgentSessionId: "workspace_source",
              workspaceScope: "worktree:" + remote,
              comparison,
              revision: 4,
            },
            path: "example.ts",
            range: { side: "additions", startLine: 1, endLine: 2 },
            quote: {
              source: "saved-patch",
              lines: [
                { lineNumber: 1, kind: "context", text: "context\r\n" },
                { lineNumber: 2, kind: "deletion", text: "old\n" },
                { lineNumber: 2, kind: "addition", text: "new" },
              ],
            },
          },
        },
      ],
    })
  },
)

test("changed patch bytes, comparison, revision or missing anchor never dispatch", async () => {
  const f = fixture(null)
  using _ = f.server
  f.state.patch = patch.replace("new", "different")
  expect((await f.submit.send(input, signal)).status).toBe("unverified")
  f.state.patch = patch
  f.state.revision++
  expect((await f.submit.send(input, signal)).status).toBe("unverified")
  f.state.revision--
  f.state.head = "c".repeat(40)
  expect((await f.submit.send(input, signal)).status).toBe("unverified")
  f.state.head = comparison.head
  expect((await f.submit.send({ ...input, draft: { comments: [{ ...comment, end: 10 }] } }, signal)).status).toBe(
    "unverified",
  )
  expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(0)
})

test("ineligible origin, wrong payer/worktree, child or revoked access never dispatch", async () => {
  const f = fixture(null)
  using _ = f.server
  f.state.destinationOrigin = "agent-manager"
  expect((await f.submit.send(input, signal)).status).toBe("unverified")
  f.state.destinationOrigin = "cloud-agent-web"
  f.state.destinationPayer = "wrong"
  expect((await f.submit.send(input, signal)).status).toBe("unverified")
  f.state.destinationPayer = null
  f.state.destinationWorkspace = "worktree_other"
  expect((await f.submit.send(input, signal)).status).toBe("unverified")
  f.state.destinationWorkspace = remote
  expect((await f.submit.send({ ...input, destinationID: "child" }, signal)).status).toBe("unverified")
  f.state.deny = true
  expect((await f.submit.send(input, signal)).status).toBe("unverified")
  expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(0)
})

test("ambiguous submission locks the draft and only a matching durable receipt acknowledges the review", async () => {
  const f = fixture(null)
  using _ = f.server
  f.state.wrongAck = true
  expect((await f.submit.send(input, signal)).status).toBe("unknown")
  f.state.receipt = { cloudAgentSessionId: "workspace_destination", status: "running", messageId: "wrong" }
  expect((await f.submit.delivery(input, signal)).status).toBe("unknown")
  f.state.receipt = { cloudAgentSessionId: "workspace_destination", status: "queued", messageId: input.messageID }
  expect((await f.submit.delivery(input, signal)).status).toBe("accepted")
  expect(f.calls.filter((c) => c.method === "POST")).toHaveLength(1)
})
