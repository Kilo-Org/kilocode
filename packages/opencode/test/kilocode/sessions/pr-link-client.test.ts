import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { simpleGit } from "simple-git"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import {
  clearSessionLink,
  enabled,
  loadSessionLinks,
  pruneLegacyWorktreeLinks,
  readSessionPrLink,
  recordPrCreate,
  recordPush,
  recordSessionLink,
  sessionLinkKey,
  writeSessionPrLink,
  type SessionPrLink,
} from "@/kilo-sessions/pr-link"
import { refreshPrLink, startPrLinkPoll } from "@/kilo-sessions/pr-link-poller"
import { Storage } from "@/storage/storage"
import { Process } from "@/util/process"
import { tmpdir } from "../../fixture/fixture"

const clients = ["vscode", "jetbrains", "desktop", "acp", "run", "unknown"]
const branch = "feature/pr-client"
const record: SessionPrLink = {
  link: { platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 },
  headRef: branch,
  headSha: "abc1234",
  evidence: "pr_create",
}
const keys: string[][] = []
const layer = LayerNode.compile(LayerNode.group([Storage.node, FSUtil.node, CrossSpawnSpawner.node]))
let client: string | undefined

beforeEach(() => {
  client = process.env.KILO_CLIENT
})

afterEach(async () => {
  if (client === undefined) delete process.env.KILO_CLIENT
  else process.env.KILO_CLIENT = client
  await Effect.runPromise(
    Storage.Service.use((svc) => Effect.all(keys.splice(0).map((key) => svc.remove(key)))).pipe(Effect.provide(layer)),
  )
})

// Seed and inspect old records without passing through the client guard.
async function seed(key: string[], value: unknown) {
  keys.push(key)
  await Effect.runPromise(Storage.Service.use((svc) => svc.write(key, value)).pipe(Effect.provide(layer)))
}

function read(key: string[]) {
  return Effect.runPromise(Storage.Service.use((svc) => svc.read(key)).pipe(Effect.provide(layer)))
}

describe("PR-link client boundary", () => {
  test("enabled reads the current client and defaults to CLI", () => {
    delete process.env.KILO_CLIENT
    expect(enabled()).toBe(true)
    process.env.KILO_CLIENT = "custom"
    expect(enabled()).toBe(false)
    process.env.KILO_CLIENT = "cli"
    expect(enabled()).toBe(true)
    process.env.KILO_CLIENT = "vscode"
    expect(enabled()).toBe(false)
    delete process.env.KILO_CLIENT
    expect(enabled()).toBe(true)
  })

  test.each(clients)("%s cannot read, overwrite, clear, refresh, or prune stored links", async (client) => {
    process.env.KILO_CLIENT = client
    expect(enabled()).toBe(false)
    const id = `ses_pr_client_${client}`
    const key = sessionLinkKey(id)
    const legacy = ["session_pr_link_recorded", id]
    const override = ["session_pr_link", id]
    const old = { key: "origin/feature/pr-client", link: record.link }
    await seed(key, record)
    await seed(legacy, old)
    await seed(override, record.link)

    expect(await readSessionPrLink(id)).toBeUndefined()
    expect(await loadSessionLinks()).toEqual(new Map())
    expect(await loadSessionLinks([id])).toEqual(new Map())

    await writeSessionPrLink(id, { ...record, headSha: "def5678" })
    expect(await read(key)).toEqual(record)
    await clearSessionLink(id)
    expect(await read(key)).toEqual(record)
    const query = spyOn(Process, "text").mockResolvedValue({
      code: 0,
      text: "[]",
      stdout: Buffer.from("[]"),
      stderr: Buffer.alloc(0),
    })
    try {
      await refreshPrLink({ sessionId: id })
      await refreshPrLink()
      expect(query).not.toHaveBeenCalled()
    } finally {
      query.mockRestore()
    }
    expect(await read(key)).toEqual(record)
    expect(await pruneLegacyWorktreeLinks()).toBe(0)
    expect(await read(legacy)).toEqual(old)
    expect(await read(override)).toEqual(record.link)

    const vacant = sessionLinkKey(`${id}_new`)
    keys.push(vacant)
    await writeSessionPrLink(`${id}_new`, record)
    const stored = await Effect.runPromise(
      Storage.Service.use((svc) => svc.list(["session_pr_link_session"])).pipe(Effect.provide(layer)),
    )
    expect(stored).not.toContainEqual(vacant)
  })

  test.each(clients)("%s ignores evidence for existing and unavailable repositories", async (client) => {
    process.env.KILO_CLIENT = client
    await using dir = await tmpdir({ git: true })
    const git = simpleGit(dir.path)
    await git.checkoutLocalBranch(branch)
    await git.addRemote("origin", "https://github.com/owner/repo.git")
    const head = (await git.revparse(["HEAD"])).trim()
    const id = `ses_pr_evidence_${client}`
    const key = sessionLinkKey(id)
    const old = { ...record, headSha: head }
    const next = {
      ...old,
      link: { ...record.link, prUrl: "https://github.com/owner/repo/pull/8", prNumber: 8 },
    }
    await seed(key, old)

    expect(await recordSessionLink(id, next, dir.path)).toBeUndefined()
    expect(await read(key)).toEqual(old)
    expect(await recordPrCreate(id, dir.path, next.link.prUrl)).toBeUndefined()
    expect(await read(key)).toEqual(old)
    const command = `git push origin ${branch}`
    const output = `   ${head}..${head}  ${branch} -> ${branch}\n`
    expect(await recordPush(id, dir.path, command, output)).toBeUndefined()
    expect(await read(key)).toEqual(old)

    const missing = path.join(dir.path, "unavailable")
    expect(await recordSessionLink(id, next, missing)).toBeUndefined()
    expect(await recordPrCreate(id, missing, next.link.prUrl)).toBeUndefined()
    expect(await recordPush(id, missing, command, output)).toBeUndefined()
    expect(await read(key)).toEqual(old)
  })

  test.each(clients)("%s starts no PR poll callback or interval", (client) => {
    process.env.KILO_CLIENT = client
    let calls = 0
    const interval = spyOn(globalThis, "setInterval")
    const stop = startPrLinkPoll(async () => {
      calls++
    })
    try {
      expect(typeof stop).toBe("function")
      stop()
      stop()
      expect(calls).toBe(0)
      expect(interval).not.toHaveBeenCalled()
    } finally {
      stop()
      interval.mockRestore()
    }
  })
})
