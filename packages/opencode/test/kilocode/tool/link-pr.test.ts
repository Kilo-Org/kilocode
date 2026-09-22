import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import simpleGit from "simple-git"
import { Agent } from "@/agent/agent"
import { InstanceRef } from "@/effect/instance-ref"
import { MessageID, SessionID } from "@/session/schema"
import * as Truncate from "@/tool/truncate"
import type { Tool } from "@/tool/tool"
import type { InstanceContext } from "@/project/instance-context"

// Replace the override writer before the tool module loads, keeping the real
// `parsePrUrl` so the tool still parses the URL for real.
const realPrLink = await import("@/kilo-sessions/pr-link")

const writes: { worktree: string; link: unknown }[] = []
let writeError: unknown

const writeOverride = mock(async (worktree: string, link: unknown) => {
  if (writeError) throw writeError
  writes.push({ worktree, link })
})

void mock.module("@/kilo-sessions/pr-link", () => ({
  ...realPrLink,
  writePrLinkOverride: writeOverride,
}))

const { LinkPrTool } = await import("@/kilocode/tool/link-pr")
const { KiloToolRegistry } = await import("@/kilocode/tool/registry")

const agentInfo = {
  name: "code",
  mode: "primary",
  options: {},
  permission: {},
} as Agent.Info

const agents = Agent.Service.of({
  get: () => Effect.succeed(agentInfo),
  list: () => Effect.succeed([agentInfo]),
  defaultInfo: () => Effect.succeed(agentInfo),
  defaultAgent: () => Effect.succeed("code"),
  generate: () => Effect.succeed({ identifier: "code", whenToUse: "", systemPrompt: "" }),
})

const truncate = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed(""),
  output: (text) => Effect.succeed({ content: text as string, truncated: false }),
  limits: () => Effect.succeed({ maxLines: Truncate.MAX_LINES, maxBytes: Truncate.MAX_BYTES }),
})

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_test",
  agent: "code",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const worktree = "/tmp/link-pr-worktree"

const created: string[] = []

afterAll(async () => {
  await Promise.all(created.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

// A real offline git repo so the tool's own-repository check can resolve the
// worktree's host, owner and repo through `identityFor`.
async function makeRepo(remote = "https://github.com/owner/repo.git") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "link-pr-"))
  created.push(dir)
  const git = simpleGit(dir)
  await git.init()
  await git.addConfig("user.email", "test@example.com")
  await git.addConfig("user.name", "Test")
  await git.checkoutLocalBranch("feature/x")
  await fs.writeFile(path.join(dir, "a.txt"), "hello")
  await git.add("a.txt")
  await git.commit("init")
  await git.addRemote("origin", remote)
  const head = (await git.revparse(["HEAD"])).trim()
  await git.raw(["update-ref", "refs/remotes/origin/feature/x", head])
  await git.addConfig("branch.feature/x.remote", "origin")
  await git.addConfig("branch.feature/x.merge", "refs/heads/feature/x")
  return dir
}

const layer = Layer.mergeAll(
  Layer.succeed(Agent.Service, agents),
  Layer.succeed(Truncate.Service, truncate),
)

beforeEach(() => {
  writes.length = 0
  writeError = undefined
  writeOverride.mockClear()
})

function run(url: string, dir = worktree) {
  const instance = { directory: dir, worktree: dir, project: {} } as unknown as InstanceContext
  return Effect.runPromise(
    Effect.gen(function* () {
      const info = yield* LinkPrTool
      const tool = yield* info.init()
      return yield* tool.execute({ url }, ctx)
    }).pipe(Effect.provide(layer), Effect.provideService(InstanceRef, instance)),
  )
}

describe("link_pr tool", () => {
  test("registers with id and description", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const info = yield* LinkPrTool
        const tool = yield* info.init()
        return { id: info.id, description: tool.description }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.id).toBe("link_pr")
    expect(result.description).toContain("pull request")
    expect(result.description).toContain("GitLab merge request")
  })

  test("rejects an empty URL", async () => {
    await expect(run("")).rejects.toBeDefined()
  })

  test("rejects a whitespace-only URL", async () => {
    await expect(run("   \n  ")).rejects.toBeDefined()
  })

  test("links a GitHub pull request", async () => {
    const result = await run("  https://github.com/owner/repo/pull/123  ")

    expect(result.metadata.ok).toBe(true)
    expect(result.metadata.platform).toBe("github")
    expect(result.metadata.prNumber).toBe(123)
    expect(result.metadata.prUrl).toBe("https://github.com/owner/repo/pull/123")
    expect(result.title).toBe("Linked github pull request #123")
    expect(result.output).toContain("https://github.com/owner/repo/pull/123")

    expect(writes).toHaveLength(1)
    expect(writes[0]?.worktree).toBe(worktree)
    expect(writes[0]?.link).toEqual({
      platform: "github",
      prUrl: "https://github.com/owner/repo/pull/123",
      prNumber: 123,
    })
  })

  test("links a GitLab merge request", async () => {
    const result = await run("https://gitlab.com/group/proj/-/merge_requests/45")

    expect(result.metadata.ok).toBe(true)
    expect(result.metadata.platform).toBe("gitlab")
    expect(result.metadata.prNumber).toBe(45)
    expect(writes[0]?.link).toEqual({
      platform: "gitlab",
      prUrl: "https://gitlab.com/group/proj/-/merge_requests/45",
      prNumber: 45,
    })
  })

  test("links a Bitbucket pull request", async () => {
    const result = await run("https://bitbucket.org/workspace/repo/pull-requests/7")

    expect(result.metadata.ok).toBe(true)
    expect(result.metadata.platform).toBe("bitbucket")
    expect(result.metadata.prNumber).toBe(7)
    expect(writes[0]?.link).toEqual({
      platform: "bitbucket",
      prUrl: "https://bitbucket.org/workspace/repo/pull-requests/7",
      prNumber: 7,
    })
  })

  test("rejects a URL that is not a pull request", async () => {
    const result = await run("https://github.com/owner/repo")

    expect(result.metadata.ok).toBe(false)
    expect(result.metadata.reason).toBe("invalid_url")
    expect(result.title).toBe("PR link rejected")
    expect(result.output).toContain("is not a pull request URL")
    expect(writes).toHaveLength(0)
  })

  test("links a pull request for the worktree's own repository", async () => {
    const dir = await makeRepo()

    const result = await run("https://github.com/owner/repo/pull/9", dir)

    expect(result.metadata.ok).toBe(true)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.worktree).toBe(dir)
  })

  test("rejects a pull request for another repository", async () => {
    const dir = await makeRepo()

    const result = await run("https://github.com/other/repo/pull/9", dir)

    expect(result.metadata.ok).toBe(false)
    expect(result.metadata.reason).toBe("wrong_repo")
    expect(result.title).toBe("PR link rejected")
    expect(result.output).toContain("is not a pull request for this repository")
    expect(writes).toHaveLength(0)
  })

  test("returns a non-retryable failure when the write fails", async () => {
    writeError = new Error("storage unavailable")

    const result = await run("https://github.com/owner/repo/pull/9")

    expect(result.metadata.ok).toBe(false)
    expect(result.metadata.reason).toBe("write_failed")
    expect(result.title).toBe("Link not stored")
    expect(result.output).toContain("call link_pr again")
    expect(writes).toHaveLength(0)
  })

  test("the built registry contains link_pr", async () => {
    const built = await Effect.runPromise(
      Effect.gen(function* () {
        const linkPr = yield* LinkPrTool
        const info = (id: string): Tool.Info => ({
          id,
          init: () =>
            Effect.succeed({
              description: id,
              parameters: Schema.String,
              execute: () => Effect.succeed({ title: id, output: id, metadata: {} }),
            }),
        })
        const infos = {
          recall: info("recall"),
          managerModels: info("agent_manager_models"),
          memory: info("kilo_memory_recall"),
          save: info("kilo_memory_save"),
          manager: info("agent_manager"),
          process: info("background_process"),
          browser: info("browser_open"),
          chart: info("chart"),
          image: info("generate_image"),
          notify: info("notify_user"),
          send: info("send_file"),
          linkPr,
        }
        return yield* KiloToolRegistry.build(infos, { agent: agents, truncate, indexing: false })
      }).pipe(Effect.provide(layer)),
    )

    expect(built.linkPr.id).toBe("link_pr")

    const ids = KiloToolRegistry.extra(
      {
        recall: built.recall,
        managerModels: built.managerModels,
        memory: built.memory,
        save: built.save,
        manager: built.manager,
        process: built.process,
        chart: built.chart,
        image: built.image,
        notify: built.notify,
        send: built.send,
        linkPr: built.linkPr,
      },
      {},
      { experimentalSharedAgentBoard: false },
    ).map((tool) => tool.id)

    expect(ids).toContain("link_pr")
  })
})
