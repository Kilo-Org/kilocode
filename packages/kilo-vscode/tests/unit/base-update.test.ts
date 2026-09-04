import { afterEach, beforeEach, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { createKiloClient, type QuestionRequest } from "@kilocode/sdk/v2/client"
import { ProjectContext } from "../../src/agent-manager/project/context"
import { baseUpdatePrompt, handleBaseUpdate } from "../../src/agent-manager/base-update"
import type { BaseUpdateRequest } from "../../webview-ui/src/types/messages/agent-manager"

const command = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim()
const servers: Array<{ stop(force: boolean): void }> = []
let root: string
let ctx: ProjectContext
let wt: ReturnType<ReturnType<ProjectContext["stateManager"]>["addWorktree"]>

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "base-update-")))
  command(root, "init", "-q", "-b", "release")
  command(
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-qm",
    "base",
    "--allow-empty",
  )
  command(root, "worktree", "add", "-q", "-b", "feature", join(root, "worktree"), "release")
  mkdirSync(join(root, ".kilo"))
  ctx = new ProjectContext("owner", root, true, { log: () => undefined })
  wt = ctx.stateManager().addWorktree({ branch: "feature", path: join(root, "worktree"), parentBranch: "release" })
})

afterEach(async () => {
  for (const server of servers.splice(0)) server.stop(true)
  await ctx.stateManager().flush()
  rmSync(root, { recursive: true, force: true })
})

function backend(failure?: string) {
  const requests: Array<{ method: string; path: string; directory: string | null; body?: unknown }> = []
  const errors: string[] = []
  const routes: unknown[] = []
  const statuses: Record<string, { type: string }> = {}
  const permissions: unknown[] = []
  const questions: QuestionRequest[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const directory = url.searchParams.get("directory")
      const body = request.headers.get("content-type")?.includes("application/json") ? await request.json() : undefined
      requests.push({ method: request.method, path: url.pathname, directory, body })
      if (url.pathname === failure) return Response.json({ message: "Blocker unavailable" }, { status: 500 })
      if (url.pathname === "/session/status") return Response.json(statuses)
      if (url.pathname === "/permission") return Response.json(permissions)
      if (url.pathname === "/question") return Response.json(questions)
      if (url.pathname === "/mcp") return Response.json({})
      if (url.pathname.endsWith("/prompt_async")) return new Response(null, { status: 204 })
      return Response.json({ id: "ses_target", title: "Target", directory, time: { created: 1, updated: 1 } })
    },
  })
  servers.push(server)
  const client = createKiloClient({ baseUrl: server.url.href })
  const host: Parameters<typeof handleBaseUpdate>[2] = {
    client: () => client,
    metadata: async () => ({}),
    notify: (msg) => errors.push(msg),
    register: (id, directory) => routes.push({ id, directory }),
    push: () => undefined,
    log: () => undefined,
    sessions: {
      register: () => {
        throw new Error("Must not replace the active session or draft")
      },
      setSessionDirectory: () => {
        throw new Error("Must not reset the current session")
      },
      registerSessionRoute: (ref, directory, generation) => routes.push({ ref, directory, generation }),
      clearDirectory: () => undefined,
      directories: () => undefined,
      abort: async () => undefined,
      forget: () => undefined,
    },
  }
  const request: BaseUpdateRequest = { type: "agentManager.updateFromBase", projectId: ctx.id, worktreeId: wt.id }
  return { requests, errors, routes, statuses, permissions, questions, host, request }
}

it("uses the saved base and remote, not the current default or cleanup branch", () => {
  ctx.stateManager().setDefaultBaseBranch("other")
  wt.originalBranch = "cleanup-only"
  wt.remote = "upstream"
  const text = baseUpdatePrompt(wt)
  expect(text).toContain('saved base branch "release"')
  expect(text).toContain('recorded remote "upstream"')
  expect(text).toContain('"refs/heads/release"')
  expect(text).not.toContain("cleanup-only")
  expect(text).not.toContain('"other"')
})

it("asks the agent to resolve the saved base upstream and stop for local-only or unavailable sources", () => {
  const text = baseUpdatePrompt(wt)
  expect(text).toContain('upstream of the saved base branch "release"')
  expect(text).toContain("local-only or cannot be resolved, stop and ask")
  expect(text).toContain("If fetch or ref resolution fails, stop")
  expect(text).toContain("Never merge a stale tracking ref")
  for (const safeguard of [
    "FETCH_HEAD^{commit}",
    "Do not use the shared stash stack or --autostash",
    "merge.autoStash",
    "intended resolution is unclear, stop and ask",
    "merge or rebase is already in progress",
    "HEAD is detached",
    "both branches' intent",
    "tests, lint, and type checks",
    "normal tool permissions",
    "Do not push",
  ])
    expect(text).toContain(safeguard)
})

it("asks the agent to preserve local work without asking the user to choose a method", () => {
  const text = baseUpdatePrompt(wt)
  for (const safeguard of [
    "Preserve all staged, unstaged, and untracked changes",
    "verified recovery copy unique to this worktree and this update before changing them",
    "Never restore or remove another worktree's recovery data",
    "Git's internal temporary merge state is allowed if it does not change the shared stash stack",
    "If preservation cannot be verified, stop and ask before clearing any edits",
    "You may temporarily clear backed-up edits to merge the base",
    "restore local changes and their staging state",
    "leave unfinished work uncommitted",
    "Keep pre-existing edits out of the merge commit",
    "Keep the recovery copy until restoration is verified",
    "Do not ask me to choose a preservation method",
  ])
    expect(text).toContain(safeguard)
  expect(text).not.toContain("stop and ask how to preserve them")
  expect(text).not.toContain("Do not discard, overwrite, stage, or commit pre-existing edits")
})

it("sends one prompt to the owning worktree, queues on its busy session, and leaves drafts alone", async () => {
  const api = backend()
  ctx.stateManager().addSession("ses_target", wt.id)
  api.statuses.ses_target = { type: "busy" }
  api.statuses.ses_child = { type: "busy" }
  const head = command(wt.path, "rev-parse", "HEAD")
  await Bun.write(join(wt.path, "draft.txt"), "uncommitted work")
  const status = command(wt.path, "status", "--porcelain")
  await handleBaseUpdate(api.request, ctx, api.host)
  expect(api.errors).toEqual([])
  expect(api.requests.every((item) => item.directory === wt.path)).toBe(true)
  expect(api.requests.filter((item) => item.path.endsWith("/prompt_async"))).toHaveLength(1)
  expect(api.requests.some((item) => item.path === "/session")).toBe(false)
  expect(api.routes).toContainEqual({
    ref: { projectId: "owner", sessionId: "ses_target" },
    directory: wt.path,
    generation: ctx.generation,
  })
  expect(command(wt.path, "rev-parse", "HEAD")).toBe(head)
  expect(command(wt.path, "status", "--porcelain")).toBe(status)
})

it.each([
  { base: "main", local: "main", current: "feature", remote: "origin" },
  { base: "main", local: "release", current: "feature", remote: "upstream" },
  { base: "release", local: "main", current: "feature", remote: undefined },
  { base: "main", local: "release", current: "another-feature", remote: "upstream" },
])(
  "keeps saved base $base when Local is $local and the worktree is $current",
  async ({ base, local, current, remote }) => {
    command(root, "branch", "main")
    command(root, "checkout", "-q", local)
    if (current !== "feature") command(wt.path, "checkout", "-qb", current)
    wt.parentBranch = base
    wt.remote = remote
    ctx.stateManager().setDefaultBaseBranch("unrelated-default")
    ctx.stateManager().addSession("ses_target", wt.id)
    const api = backend()
    await handleBaseUpdate(api.request, ctx, api.host)
    expect(api.errors).toEqual([])
    const sent = api.requests.find((item) => item.path.endsWith("/prompt_async"))
    const text = (sent?.body as { parts: Array<{ text: string }> }).parts.at(0)?.text
    expect(sent?.directory).toBe(wt.path)
    expect(text).toContain(`saved base branch "${base}"`)
    expect(text).toContain("worktree's current branch")
    expect(text).toContain("Do not switch branches")
    expect(text).not.toContain("unrelated-default")
    expect(command(root, "branch", "--show-current")).toBe(local)
    expect(command(wt.path, "branch", "--show-current")).toBe(current)
  },
)

it("keeps the requested worktree when a different worktree is selected", async () => {
  const path = join(root, "other")
  command(root, "worktree", "add", "-q", "-b", "other", path)
  const state = ctx.stateManager()
  const other = state.addWorktree({ branch: "other", path, parentBranch: "other-base" })
  state.addSession("ses_other", other.id)
  state.addSession("ses_target", wt.id)
  state.setActiveTarget({ kind: "worktree", projectId: ctx.id, worktreeId: other.id })
  const api = backend()
  api.statuses.ses_other = { type: "busy" }
  await handleBaseUpdate(api.request, ctx, api.host)
  expect(api.errors).toEqual([])
  expect(api.requests.every((item) => item.directory === wt.path)).toBe(true)
  expect(api.requests.some((item) => item.path === "/session/ses_target/prompt_async")).toBe(true)
  expect(api.requests.some((item) => item.path.includes("ses_other"))).toBe(false)
})

it("creates a session in the target worktree without replacing the user's active draft", async () => {
  const api = backend()
  await handleBaseUpdate(api.request, ctx, api.host)
  expect(api.errors).toEqual([])
  expect(ctx.stateManager().getSession("ses_target")?.worktreeId).toBe(wt.id)
  expect(api.requests.filter((item) => item.path === "/session")).toHaveLength(1)
  expect(api.requests.filter((item) => item.path.endsWith("/prompt_async"))).toHaveLength(1)
})

it("lets the backend queue the update prompt before dismissing target questions", async () => {
  const api = backend()
  ctx.stateManager().addSession("ses_other", wt.id)
  ctx.stateManager().addSession("ses_target", wt.id)
  api.statuses.ses_target = { type: "busy" }
  api.permissions.push({ id: "perm_other", sessionID: "ses_other" })
  api.questions.push(
    { id: "que_other", sessionID: "ses_other", questions: [] },
    ...["que_first", "que_second"].map((id) => ({
      id,
      sessionID: "ses_target",
      questions: [
        { header: "Plan", question: "Ready to implement?", options: [{ label: "Yes", description: "Start" }] },
      ],
    })),
  )
  await handleBaseUpdate({ ...api.request, sessionId: "ses_target" }, ctx, api.host)
  expect(api.errors).toEqual([])
  expect(api.requests.every((item) => item.directory === wt.path)).toBe(true)
  expect(api.requests.filter((item) => item.method === "POST").map((item) => item.path)).toEqual([
    "/session/ses_target/prompt_async",
  ])
})

it.each(["/question", "/permission"])("does not prompt when blocker lookup fails at %s", async (failure) => {
  const api = backend(failure)
  ctx.stateManager().addSession("ses_target", wt.id)
  api.questions.push({
    id: "que_target",
    sessionID: "ses_target",
    questions: [{ header: "Plan", question: "Ready to implement?", options: [] }],
  })
  await handleBaseUpdate(api.request, ctx, api.host)
  expect(api.errors).toHaveLength(1)
  expect(api.requests.map((item) => item.path)).toContain(failure)
  expect(api.requests.some((item) => item.method === "POST")).toBe(false)
  expect(api.questions).toHaveLength(1)
})

it("leaves questions pending when a permission blocks the target session", async () => {
  const api = backend()
  ctx.stateManager().addSession("ses_target", wt.id)
  api.permissions.push({ id: "perm_target", sessionID: "ses_target" })
  api.questions.push({
    id: "que_target",
    sessionID: "ses_target",
    questions: [{ header: "Plan", question: "Ready to implement?", options: [] }],
  })
  await handleBaseUpdate(api.request, ctx, api.host)
  expect(api.errors).toHaveLength(1)
  expect(api.errors.at(0)).toContain("pending permission")
  expect(api.requests.some((item) => item.method === "POST")).toBe(false)
  expect(api.questions).toHaveLength(1)
})

it("rejects wrong ownership, competing sessions, and pending permissions", async () => {
  const api = backend()
  ctx.stateManager().addSession("ses_local", null)
  ctx.stateManager().addSession("ses_target", wt.id)
  await handleBaseUpdate({ ...api.request, projectId: "other" }, ctx, api.host)
  await handleBaseUpdate({ ...api.request, sessionId: "ses_local" }, ctx, api.host)
  ctx.stateManager().addSession("ses_other", wt.id)
  api.statuses.ses_other = { type: "busy" }
  await handleBaseUpdate({ ...api.request, sessionId: "ses_target" }, ctx, api.host)
  delete api.statuses.ses_other
  api.permissions.push({ id: "perm", sessionID: "ses_target" })
  await handleBaseUpdate(api.request, ctx, api.host)
  expect(api.errors).toHaveLength(4)
  expect(api.errors.at(-1)).toContain("pending permission")
  expect(api.requests.some((item) => item.body)).toBe(false)
})
