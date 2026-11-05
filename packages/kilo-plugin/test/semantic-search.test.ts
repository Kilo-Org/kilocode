import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { VectorStoreSearchResult } from "@kilocode/kilo-indexing/engine"
import type { IndexingStatus } from "@kilocode/kilo-indexing/status"
import type { AssertInput } from "@opencode/plugin/permission"
import { Agent } from "@opencode/schema/agent"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { Effect, Exit } from "effect"
import { IndexingRuntime } from "../src/indexing/runtime"
import { semanticSearch } from "../src/indexing/semantic-search"

const context: Tool.Context = {
  sessionID: SessionID.make("ses_semantic"),
  agent: Agent.ID.make("code"),
  messageID: SessionMessage.ID.make("msg_semantic"),
  id: Tool.CallID.make("call_semantic"),
  progress: () => Effect.void,
}

const complete: IndexingStatus = { state: "Complete", message: "", processedFiles: 2, totalFiles: 2, percent: 100 }

function tool(input: {
  directory?: string
  results?: VectorStoreSearchResult[]
  status?: IndexingStatus
  deny?: boolean
}) {
  const calls = { asks: [] as AssertInput[], searches: [] as { query: string; prefix?: string }[] }
  const info = semanticSearch({
    directory: input.directory ?? "/repo",
    assert: (request) => {
      calls.asks.push(request)
      return input.deny ? Effect.fail(new Error("denied")) : Effect.void
    },
    search: async (query, prefix) => {
      calls.searches.push({ query, prefix })
      return input.results ?? []
    },
    current: async () => input.status ?? complete,
  })
  return { info, calls, run: (params: { query: string; path?: string }) => Effect.runPromiseExit(info.execute(params, context)) }
}

const result = (filePath: string, score: number): VectorStoreSearchResult => ({
  id: filePath,
  score,
  payload: { filePath, codeChunk: `chunk of ${filePath}`, startLine: 3, endLine: 9 },
})

describe("tool.semantic_search", () => {
  test("describes code snippet results and is a direct tool", () => {
    const { info } = tool({})
    expect(info.name).toBe("semantic_search")
    expect(info.description).toContain("Find code snippets by semantic meaning")
    expect(info.options).toEqual({ codemode: false })
  })

  test("fails when the query is empty", async () => {
    const exit = await tool({}).run({ query: "" })
    expect(Exit.isFailure(exit)).toBe(true)
  })

  test("asks permission and forwards a normalized relative path to the index", async () => {
    const { run, calls } = tool({ results: [result("src/auth.ts", 0.91)] })
    const exit = await run({ query: "password hashing", path: "./src/../src/auth" })
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(calls.asks).toEqual([
      {
        sessionID: context.sessionID,
        agent: context.agent,
        action: "semantic_search",
        resources: ["password hashing"],
        save: ["*"],
        metadata: { query: "password hashing", path: "./src/../src/auth" },
      },
    ])
    expect(calls.searches).toEqual([{ query: "password hashing", prefix: path.normalize("src/auth") }])
  })

  test("does not search when permission is denied", async () => {
    const { run, calls } = tool({ deny: true })
    expect(Exit.isFailure(await run({ query: "login" }))).toBe(true)
    expect(calls.searches).toEqual([])
  })

  test("searches the entire workspace when path is omitted or the root", async () => {
    const { run, calls } = tool({})
    await run({ query: "login" })
    await run({ query: "login", path: "." })
    expect(calls.searches.map((item) => item.prefix)).toEqual([undefined, undefined])
  })

  test("formats and normalizes search results", async () => {
    const exit = await tool({ results: [result("src\\auth.ts", 0.91234), result("src/db.ts", 0.5)] }).run({ query: "auth" })
    if (!Exit.isSuccess(exit)) throw new Error("expected success")
    expect(exit.value.output).toBe(
      [
        'Found 2 results for "auth" in /repo.',
        "",
        "1. src/auth.ts:3-9 (score 0.9123)",
        "chunk of src\\auth.ts",
        "",
        "2. src/db.ts:3-9 (score 0.5000)",
        "chunk of src/db.ts",
      ].join("\n"),
    )
    expect(exit.value.metadata?.results).toHaveLength(2)
  })

  test("rejects paths outside the workspace", async () => {
    const { run, calls } = tool({})
    expect(Exit.isFailure(await run({ query: "auth", path: "../other" }))).toBe(true)
    expect(calls.searches).toEqual([])
  })

  test("explains an empty result with the index state", async () => {
    const exit = await tool({
      status: { state: "In Progress", message: "", processedFiles: 3, totalFiles: 10, percent: 30 },
    }).run({ query: "auth" })
    if (!Exit.isSuccess(exit)) throw new Error("expected success")
    expect(exit.value.output).toContain('No results for "auth" in /repo.')
    expect(exit.value.output).toContain("The index is still building (30%, 3/10 files), so results are incomplete.")
    expect(exit.value.metadata?.state).toBe("In Progress")
  })
})

// The engine degrades to a scan-only index when the native watcher cannot subscribe, as some containers cannot.
const watcher = await probeWatcher()

// The real engine in its worker, a real LanceDB store, and a local OpenAI-compatible embedding service whose vectors
// are hashed bags of words, so related text scores higher without a paid model.
describe("semantic_search over a real index", () => {
  const cleanup: (() => Promise<void>)[] = []
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((item) => item()))
  })

  const words = (text: string) => text.toLowerCase().match(/[a-z]{3,}/g) ?? []
  const embed = (text: string) => {
    const vector = Array.from({ length: 64 }, () => 0)
    for (const word of words(text)) vector[[...word].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 64, 7)]! += 1
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
    return vector.map((value) => value / norm)
  }

  async function repository() {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body = (await request.json()) as { input: string | string[] }
        const input = Array.isArray(body.input) ? body.input : [body.input]
        return Response.json({
          object: "list",
          model: "fixture-model",
          data: input.map((text, index) => ({ object: "embedding", index, embedding: embed(text) })),
          usage: { prompt_tokens: 1, total_tokens: 1 },
        })
      },
    })
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-semantic-")))
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-semantic-index-")))
    await mkdir(path.join(directory, "src"))
    await Bun.write(
      path.join(directory, "src/auth.ts"),
      "// Hashes the user password with a salt before the login check stores it.\nexport function hashPassword(password: string, salt: string) {\n  return Bun.hash(password + salt).toString()\n}\n",
    )
    await Bun.write(
      path.join(directory, "src/render.ts"),
      "// Draws the chart canvas with colored bars for each series.\nexport function drawChart(canvas: string, series: number[]) {\n  return series.map((value) => canvas + value).join(',')\n}\n",
    )
    const published: IndexingStatus[] = []
    const runtime = new IndexingRuntime.Runtime({
      directory,
      home: "/nonexistent-home",
      root,
      config: async () => ({
        enabled: true,
        provider: "openai-compatible",
        model: "fixture-model",
        dimension: 64,
        searchMinScore: 0.1,
        "openai-compatible": { baseUrl: `http://127.0.0.1:${server.port}/v1`, apiKey: "fixture" },
      }),
      auth: async () => ({}),
      catalog: async () => ({ defaultModel: "", models: [], aliases: {} }),
      lancedb: async () => {},
      primary: async () => undefined,
      publish: async (status) => {
        published.push(status)
      },
      warning: () => {},
      log: () => {},
      env: {},
    })
    cleanup.unshift(async () => {
      await runtime.dispose()
      server.stop(true)
      await rm(directory, { recursive: true, force: true })
      await rm(root, { recursive: true, force: true })
    })
    await runtime.init()
    const done = async () => {
      for (const _ of Array.from({ length: 400 })) {
        const status = await runtime.current()
        if (status.state === "Complete" || status.state === "Error") return status
        await Bun.sleep(50)
      }
      return runtime.current()
    }
    return { directory, runtime, published, done }
  }

  test("indexes a repository and finds related code", async () => {
    const { directory, runtime, published, done } = await repository()
    expect((await done()).state).toBe("Complete")
    expect(runtime.ready()).toBe(true)
    expect(published.some((status) => status.state === "In Progress")).toBe(true)

    const search = semanticSearch({
      directory,
      assert: () => Effect.void,
      search: (query, prefix) => runtime.search(query, prefix),
      current: () => runtime.current(),
    })
    const first = await Effect.runPromise(search.execute({ query: "hash the login password with salt" }, context))
    expect(first.output?.split("\n")[2]).toStartWith("1. src/auth.ts:")
  })

  test.skipIf(watcher !== undefined)("follows a file edit through the file watcher", async () => {
    const { directory, runtime, done } = await repository()
    expect((await done()).state).toBe("Complete")

    const file = path.join(directory, "src/upload.ts")
    const text =
      "// Waits longer after each failed upload attempt.\nexport function retryDelay(upload: string, attempt: number) {\n  return upload.length + Math.min(30000, 500 * 2 ** attempt)\n}\n"
    await Bun.write(file, text)
    const found = async () => {
      for (const round of Array.from({ length: 60 })) {
        const hits = await runtime.search("retry delay for an upload attempt")
        if (hits[0]?.payload?.filePath === "src/upload.ts") return true
        // A creation before the subscription finished is not replayed; a second write is an update it always sees.
        if (round === 20) await Bun.write(file, text)
        await Bun.sleep(500)
      }
      return false
    }
    expect(await found()).toBe(true)
  }, 90_000)
})

/** The reason the native watcher cannot subscribe to a scratch directory, or undefined when it can. */
async function probeWatcher() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-watch-probe-"))
  try {
    const engine = path.dirname(Bun.resolveSync("@kilocode/kilo-indexing/engine", import.meta.dir))
    const module = (await import(Bun.resolveSync("@parcel/watcher", engine))) as typeof import("@parcel/watcher")
    const backend =
      process.platform === "linux"
        ? "inotify"
        : process.platform === "darwin"
          ? "fs-events"
          : process.platform === "win32"
            ? "windows"
            : undefined
    const subscription = await module.subscribe(directory, () => {}, backend ? { backend } : {})
    await subscription.unsubscribe()
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
