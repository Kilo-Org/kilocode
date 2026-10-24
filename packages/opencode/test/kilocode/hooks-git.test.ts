import { afterAll, afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import { KiloHookGit } from "@/kilocode/hooks/git"
import type { KiloHooks } from "@/kilocode/hooks/hooks"
import type { InstanceContext } from "@/project/instance-context"
import { Server } from "@/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

// Exec-form hooks need no shell quoting: `bun -e <code>`.
const exec = (code: string): KiloHooks.Handler => ({ type: "command", command: process.execPath, args: ["-e", code] })
// Appends the hook input and its working directory to a marker file, then runs `extra` with `input` in scope.
const record = (file: string, extra = "") =>
  exec(
    `const fs = require('fs'); const input = JSON.parse(fs.readFileSync(0, 'utf8')); fs.appendFileSync(${JSON.stringify(file)}, JSON.stringify({ ...input, pwd: process.cwd() }) + '\\n'); ${extra}`,
  )
const lines = async (file: string) =>
  (await Bun.file(file).exists())
    ? (await Bun.file(file).text())
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : []

/** Trusted hooks: a managed config directory (project config hooks are ignored). Returns a restore. */
async function managed(hooks: KiloHooks.Hooks) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-hooks-managed-"))
  await Bun.write(path.join(dir, "kilo.json"), JSON.stringify({ hooks }))
  const prev = process.env.KILO_TEST_MANAGED_CONFIG_DIR
  process.env.KILO_TEST_MANAGED_CONFIG_DIR = dir
  return async () => {
    if (prev === undefined) delete process.env.KILO_TEST_MANAGED_CONFIG_DIR
    else process.env.KILO_TEST_MANAGED_CONFIG_DIR = prev
    await fs.rm(dir, { recursive: true, force: true })
  }
}

// An OpenAI-compatible provider that answers every completion with `reply.text`.
const reply = { text: "feat(src): add hello" }
const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch() {
    const events = [{ delta: { role: "assistant", content: reply.text } }, { delta: {}, finish_reason: "stop" }]
    return new Response(
      events.map((choice) => `data: ${JSON.stringify({ id: "test", choices: [choice] })}\n\n`).join("") +
        "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    )
  },
})

const config = () => ({
  model: "test/small",
  small_model: "test/small",
  enabled_providers: ["test"],
  formatter: false,
  lsp: false,
  provider: {
    test: {
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: `${provider.url.origin}/v1`, apiKey: "test-key" },
      models: { small: { name: "Small", limit: { context: 100000, output: 1024 } } },
    },
  },
})

function request(root: string, route: string, body: unknown) {
  return Server.Default().app.request(route, {
    method: "POST",
    headers: { "content-type": "application/json", "x-kilo-directory": root },
    body: JSON.stringify(body),
  })
}

afterAll(async () => {
  await provider.stop(true)
})

afterEach(async () => {
  reply.text = "feat(src): add hello"
  await disposeAllInstances()
  await resetDatabase()
})

describe("CommitMessage hooks", () => {
  test("rewrite the generated message, the last hook in config order winning", async () => {
    await using tmp = await tmpdir({ git: true, config: config() })
    await Bun.write(path.join(tmp.path, "note.txt"), "hello")
    const marker = path.join(tmp.path, "..", `${path.basename(tmp.path)}-commit`)
    const restore = await managed({
      CommitMessage: [
        {
          hooks: [
            record(
              marker,
              "console.log(JSON.stringify({ hookSpecificOutput: { commitMessage: 'PROJ-1: ' + input.commit_message } }))",
            ),
          ],
        },
        {
          hooks: [
            exec(
              "const input = JSON.parse(require('fs').readFileSync(0, 'utf8')); console.log(JSON.stringify({ hookSpecificOutput: { commitMessage: 'PROJ-2: ' + input.commit_message } }))",
            ),
          ],
        },
      ],
    })
    try {
      const res = await request(tmp.path, "/commit-message", {
        path: tmp.path,
        selectedFiles: ["note.txt"],
        language: "en",
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ message: "PROJ-2: feat(src): add hello" })
      const inputs = await lines(marker)
      expect(inputs).toHaveLength(1)
      expect(inputs.at(0)).toMatchObject({
        hook_event_name: "CommitMessage",
        commit_message: "feat(src): add hello",
        selected_files: ["note.txt"],
        language: "en",
        kilo_path: tmp.path,
      })
      expect(inputs.at(0)?.session_id).toBeUndefined()
      expect(await fs.realpath(String(inputs.at(0)?.pwd))).toBe(await fs.realpath(tmp.path))
    } finally {
      await restore()
      await fs.rm(marker, { force: true })
    }
  })

  test("a blocking hook rejects the message like a failed generation", async () => {
    await using tmp = await tmpdir({ git: true, config: config() })
    await Bun.write(path.join(tmp.path, "note.txt"), "hello")
    const restore = await managed({
      CommitMessage: [{ hooks: [exec("process.stderr.write('missing ticket id'); process.exit(2)")] }],
    })
    try {
      const res = await request(tmp.path, "/commit-message", { path: tmp.path })
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({ message: "A CommitMessage hook rejected the message: missing ticket id" })
    } finally {
      await restore()
    }
  })

  test("ignores CommitMessage hooks from the project's own config", async () => {
    await using tmp = await tmpdir({ git: true, config: config() })
    await Bun.write(path.join(tmp.path, "note.txt"), "hello")
    const marker = path.join(tmp.path, "..", `${path.basename(tmp.path)}-project-commit`)
    await Bun.write(
      path.join(tmp.path, "kilo.json"),
      JSON.stringify({
        hooks: {
          CommitMessage: [{ hooks: [record(marker, "process.stderr.write('project says no'); process.exit(2)")] }],
        },
      }),
    )
    try {
      const res = await request(tmp.path, "/commit-message", { path: tmp.path })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ message: "feat(src): add hello" })
      expect(await lines(marker)).toEqual([])
    } finally {
      await fs.rm(marker, { force: true })
    }
  })

  test("a repository path outside the project never becomes the hook's working directory", async () => {
    await using tmp = await tmpdir({ git: true, config: config() })
    await using outside = await tmpdir({ git: true })
    await Bun.write(path.join(outside.path, "note.txt"), "hello")
    const marker = path.join(tmp.path, "..", `${path.basename(tmp.path)}-outside`)
    const restore = await managed({ CommitMessage: [{ hooks: [record(marker)] }] })
    try {
      const res = await request(tmp.path, "/commit-message", { path: outside.path })
      expect(res.status).toBe(200)
      const inputs = await lines(marker)
      expect(inputs.at(0)?.kilo_path).toBe(outside.path)
      expect(await fs.realpath(String(inputs.at(0)?.pwd))).toBe(await fs.realpath(tmp.path))
    } finally {
      await restore()
      await fs.rm(marker, { force: true })
    }
  })

  test("resolves the working directory inside the project, through symlinks", async () => {
    await using tmp = await tmpdir({ git: true })
    await using outside = await tmpdir()
    const sub = path.join(tmp.path, "packages", "app")
    await fs.mkdir(sub, { recursive: true })
    await fs.symlink(outside.path, path.join(tmp.path, "escape"), "dir")
    const instance = { directory: tmp.path, worktree: tmp.path } as InstanceContext
    const resolve = (target: string, ctx = instance) =>
      Effect.runPromise(KiloHookGit.directory(target).pipe(Effect.provideService(InstanceRef, ctx)))
    expect(await resolve(sub)).toBe(await fs.realpath(sub))
    expect(await resolve(outside.path)).toBe(tmp.path)
    expect(await resolve(path.join(tmp.path, "escape"))).toBe(tmp.path)
    expect(await resolve(path.join(tmp.path, "missing"))).toBe(tmp.path)
    expect(await resolve(path.join(tmp.path, "..", ".."))).toBe(tmp.path)
    // Outside git the instance worktree is "/": the instance directory bounds the path instead.
    expect(await resolve(outside.path, { directory: sub, worktree: "/" } as InstanceContext)).toBe(sub)
  })
})

describe("BranchName hooks", () => {
  const session = async (root: string) => {
    const res = await Server.Default().app.request("/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-kilo-directory": root },
      body: JSON.stringify({ title: "Branch naming" }),
    })
    return ((await res.json()) as { id: string }).id
  }

  test("a hook rewrites the generated name and sees the prompt", async () => {
    await using tmp = await tmpdir({ git: true, config: config() })
    const marker = path.join(tmp.path, "..", `${path.basename(tmp.path)}-branch`)
    const restore = await managed({
      BranchName: [
        {
          hooks: [
            record(
              marker,
              "console.log(JSON.stringify({ hookSpecificOutput: { branchName: 'proj-1-' + input.branch_name } }))",
            ),
          ],
        },
      ],
    })
    try {
      reply.text = "fix-token-refresh-race"
      const id = await session(tmp.path)
      const res = await request(tmp.path, `/session/${id}/branch-name`, { prompt: "Fix the token refresh race" })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ branch: "proj-1-fix-token-refresh-race" })
      expect(await lines(marker)).toEqual([
        expect.objectContaining({
          hook_event_name: "BranchName",
          session_id: id,
          branch_name: "fix-token-refresh-race",
          prompt: "Fix the token refresh race",
        }),
      ])
    } finally {
      await restore()
      await fs.rm(marker, { force: true })
    }
  })

  test("a blocking hook keeps the worktree's current name", async () => {
    await using tmp = await tmpdir({ git: true, config: config() })
    const restore = await managed({
      BranchName: [{ hooks: [exec("process.stderr.write('names come from the ticket'); process.exit(2)")] }],
    })
    try {
      reply.text = "fix-token-refresh-race"
      const id = await session(tmp.path)
      const res = await request(tmp.path, `/session/${id}/branch-name`, { prompt: "Fix the token refresh race" })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ branch: null })
    } finally {
      await restore()
    }
  })

  test("ignores BranchName hooks from the project's own config", async () => {
    await using tmp = await tmpdir({ git: true, config: config() })
    const marker = path.join(tmp.path, "..", `${path.basename(tmp.path)}-project-branch`)
    await Bun.write(
      path.join(tmp.path, "kilo.json"),
      JSON.stringify({
        hooks: {
          BranchName: [{ hooks: [record(marker, "process.stderr.write('project says no'); process.exit(2)")] }],
        },
      }),
    )
    try {
      reply.text = "add-health-check"
      const id = await session(tmp.path)
      const res = await request(tmp.path, `/session/${id}/branch-name`, { prompt: "Add a health check endpoint" })
      expect(await res.json()).toEqual({ branch: "add-health-check" })
      expect(await lines(marker)).toEqual([])
    } finally {
      await fs.rm(marker, { force: true })
    }
  })

  test("no hook leaves the generated name unchanged", async () => {
    await using tmp = await tmpdir({ git: true, config: config() })
    reply.text = "add-health-check"
    const id = await session(tmp.path)
    const res = await request(tmp.path, `/session/${id}/branch-name`, { prompt: "Add a health check endpoint" })
    expect(await res.json()).toEqual({ branch: "add-health-check" })
  })
})
