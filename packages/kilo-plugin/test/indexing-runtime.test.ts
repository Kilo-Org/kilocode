import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { IndexingConfigInput } from "@kilocode/kilo-indexing/engine"
import type { KiloEmbeddingModelCatalog } from "@kilocode/kilo-indexing/embedding-models"
import type { IndexingStatus } from "@kilocode/kilo-indexing/status"
import { Effect } from "effect"
import { IndexingWorker } from "../src/indexing/indexing-worker-client"
import type { IndexingWarning } from "../src/indexing/indexing-warning"
import { primaryWorktree } from "../src/indexing/primary-worktree"
import { IndexingRuntime } from "../src/indexing/runtime"

const dirs: string[] = []
const runtimes: IndexingRuntime.Runtime[] = []
const gateways: ReturnType<typeof Bun.serve>[] = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
  for (const gateway of gateways.splice(0)) gateway.stop(true)
  IndexingWorker.override()
  IndexingRuntime.resetConsent()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tmp() {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-indexing-runtime-")))
  dirs.push(dir)
  return dir
}

const complete: IndexingStatus = { state: "Complete", message: "Index up-to-date.", processedFiles: 1, totalFiles: 1, percent: 100 }

// A stand-in engine driver: records each init and lets a test drive the status hooks.
function engine(init: (input: IndexingConfigInput, baseline?: string) => Promise<IndexingStatus> = async () => complete) {
  const state = {
    created: 0,
    disposed: 0,
    inits: [] as { input: IndexingConfigInput; baseline?: string }[],
    hooks: undefined as IndexingWorker.Hooks | undefined,
  }
  IndexingWorker.override((_directory, _root, hooks) => {
    state.created++
    state.hooks = hooks
    return {
      init: (input, baseline) => {
        state.inits.push({ input, baseline })
        return init(input, baseline)
      },
      search: async () => [
        { id: "1", score: 0.9, payload: { filePath: "src/a.ts", codeChunk: "x", startLine: 1, endLine: 2 } },
      ],
      dispose: async () => {
        state.disposed++
      },
    }
  })
  return state
}

const emptyCatalog: KiloEmbeddingModelCatalog = { defaultModel: "", models: [], aliases: {} }
const catalog: KiloEmbeddingModelCatalog = {
  defaultModel: "kilo-default",
  models: [
    { id: "kilo/default-embed", name: "Default", dimension: 1536, scoreThreshold: 0.35 },
    { id: "kilo/large-embed", name: "Large", dimension: 3072, scoreThreshold: 0.25 },
  ],
  aliases: { "kilo-default": "kilo/default-embed" },
}

function host(input: {
  directory: string
  home?: string
  indexing?: Parameters<typeof IndexingRuntime.input>[0]
  auth?: { apiKey?: string; baseUrl?: string; organizationId?: string }
  catalog?: KiloEmbeddingModelCatalog
  env?: Record<string, string | undefined>
  primary?: (dir: string) => Promise<string | undefined>
}) {
  const record = {
    published: [] as IndexingStatus[],
    warnings: [] as IndexingWarning[],
    catalogs: 0,
  }
  const runtime = new IndexingRuntime.Runtime({
    directory: input.directory,
    home: input.home ?? "/nonexistent-home",
    root: path.join(input.directory, ".index-root"),
    config: async () => input.indexing,
    auth: async () => input.auth ?? {},
    catalog: async () => {
      record.catalogs++
      return input.catalog ?? emptyCatalog
    },
    lancedb: async () => {},
    primary: input.primary ?? (async () => undefined),
    publish: async (status) => {
      record.published.push(status)
    },
    warning: (item) => record.warnings.push(item),
    log: () => {},
    env: input.env ?? {},
  })
  runtimes.push(runtime)
  return { runtime, record }
}

const settled = async (runtime: IndexingRuntime.Runtime) => {
  await runtime.init()
  for (const _ of Array.from({ length: 50 })) {
    if ((await runtime.current()).message !== "Indexing is initializing.") return runtime.current()
    await Bun.sleep(10)
  }
  return runtime.current()
}

// A local Gateway for the model probe: the runtime validates the catalog default against the real embedder, so tests
// answer `/api/gateway/embeddings` instead of mocking the request.
function gateway(fetch: (request: Request) => Response | Promise<Response>) {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch })
  gateways.push(server)
  return `http://127.0.0.1:${server.port}`
}

const embedding = (dimension: number) =>
  Response.json({
    object: "list",
    data: [{ object: "embedding", index: 0, embedding: Array.from({ length: dimension }, () => 0.1) }],
    usage: { prompt_tokens: 1, total_tokens: 1 },
  })

describe("indexing runtime", () => {
  test("stays disabled when indexing enablement is unset", async () => {
    const state = engine()
    const { runtime } = host({ directory: await tmp(), indexing: { provider: "ollama" } })
    expect(await settled(runtime)).toMatchObject({ state: "Disabled", message: "Indexing disabled." })
    expect(state.created).toBe(0)
    expect(runtime.ready()).toBe(false)
  })

  test("warns for home and root workspaces without allocating an engine", async () => {
    const state = engine()
    const home = await tmp()
    for (const directory of [home, "/"]) {
      const { runtime } = host({ directory, home, indexing: { enabled: true, provider: "ollama" } })
      const status = await settled(runtime)
      expect(status.state).toBe("Disabled")
      expect(status.message).toContain("disabled in home and filesystem root directories")
    }
    expect(state.created).toBe(0)
  })

  test("stays disabled when VS Code starts without a workspace folder", async () => {
    engine()
    const { runtime } = host({
      directory: await tmp(),
      indexing: { enabled: true },
      env: { KILO_DISABLE_CODEBASE_INDEXING: "vscode-no-workspace" },
    })
    expect((await settled(runtime)).message).toBe(
      "Codebase indexing is disabled because no workspace folder is open in VS Code.",
    )
  })

  test("requires explicit VS Code consent even when config enables indexing", async () => {
    const state = engine()
    const { runtime } = host({
      directory: await tmp(),
      indexing: { enabled: true, provider: "ollama" },
      env: { KILO_PLATFORM: "vscode" },
    })
    expect((await settled(runtime)).message).toBe(
      "Codebase indexing is disabled until you enable it for this project in Kilo Settings.",
    )
    expect(runtime.consented()).toBe(false)
    expect(state.created).toBe(0)

    await runtime.consent(true)
    expect(runtime.consented()).toBe(true)
    expect(await settled(runtime)).toEqual(complete)
    expect(state.created).toBe(1)

    await runtime.consent(false)
    expect((await settled(runtime)).state).toBe("Disabled")
    expect(state.disposed).toBe(1)
  })

  test("VS Code enables indexing from consent even when config leaves it unset", async () => {
    const state = engine()
    const { runtime } = host({ directory: await tmp(), indexing: { provider: "ollama" }, env: { KILO_PLATFORM: "vscode" } })
    await runtime.consent(true)
    expect(await settled(runtime)).toEqual(complete)
    expect(state.inits[0]?.input.enabled).toBe(true)
  })

  test("shares consent across the Locations of one project and revokes every engine", async () => {
    const state = engine()
    const project = await tmp()
    const other = await tmp()
    const env = { KILO_PLATFORM: "vscode" }
    const left = host({ directory: project, indexing: { provider: "ollama" }, env, primary: async () => project })
    const right = host({ directory: other, indexing: { provider: "ollama" }, env, primary: async () => project })
    await settled(left.runtime)
    await settled(right.runtime)

    await left.runtime.consent(true)
    expect((await settled(right.runtime)).state).toBe("Complete")
    expect(right.runtime.consented()).toBe(true)
    expect(state.created).toBe(2)

    await right.runtime.consent(false)
    expect((await settled(left.runtime)).state).toBe("Disabled")
    expect(state.disposed).toBe(2)
  })

  test("consent is ignored outside VS Code", async () => {
    const state = engine()
    const { runtime } = host({ directory: await tmp(), indexing: { enabled: true, provider: "ollama" } })
    await settled(runtime)
    await runtime.consent(false)
    expect(state.created).toBe(1)
    expect(state.disposed).toBe(0)
  })

  test("does not resolve the Kilo model catalog when indexing is disabled", async () => {
    engine()
    const { runtime, record } = host({ directory: await tmp(), indexing: { provider: "kilo", model: "bogus" } })
    expect((await settled(runtime)).state).toBe("Disabled")
    expect(record.catalogs).toBe(0)
  })

  test("defaults to Kilo with the account credentials and the hosted model", async () => {
    const state = engine()
    const baseUrl = gateway(() => embedding(1536))
    const { runtime } = host({
      directory: await tmp(),
      indexing: { enabled: true },
      auth: { apiKey: "kilo-token", baseUrl, organizationId: "org_1" },
      catalog,
    })
    await settled(runtime)
    expect(state.inits[0]?.input).toMatchObject({
      embedderProvider: "kilo",
      kiloApiKey: "kilo-token",
      kiloBaseUrl: baseUrl,
      kiloOrganizationId: "org_1",
      modelId: "kilo/default-embed",
      modelDimension: 1536,
      searchMinScore: 0.35,
    })
  })

  test("falls back to a servable catalog model when the catalog default is unavailable", async () => {
    const state = engine()
    const seen: string[] = []
    const baseUrl = gateway(async (request) => {
      const model = ((await request.json()) as { model?: string }).model ?? ""
      seen.push(model)
      if (model === "kilo/default-embed")
        return Response.json({ error: { message: "not available" } }, { status: 404 })
      return embedding(model === "kilo/large-embed" ? 3072 : 768)
    })
    const { runtime } = host({
      directory: await tmp(),
      indexing: { enabled: true },
      auth: { apiKey: "kilo-token", baseUrl },
      catalog: {
        defaultModel: "kilo-default",
        models: [
          { id: "kilo/default-embed", name: "Default", dimension: 1536, scoreThreshold: 0.35 },
          { id: "kilo/other-embed", name: "Other", dimension: 768, scoreThreshold: 0.3 },
          { id: "kilo/large-embed", name: "Large", dimension: 3072, scoreThreshold: 0.25, note: "code" },
        ],
        aliases: { "kilo-default": "kilo/default-embed" },
      },
    })

    expect(await settled(runtime)).toEqual(complete)
    expect(state.inits[0]?.input).toMatchObject({
      modelId: "kilo/large-embed",
      modelDimension: 3072,
      searchMinScore: 0.25,
    })
    // The code-tuned model is preferred over the earlier catalog entry once the default is refused.
    expect(seen).toEqual(["kilo/default-embed", "kilo/large-embed"])
  })

  // VS Code saves the default it shows when indexing is enabled, so the saved id must get the same treatment.
  test("replaces a saved catalog default that the Gateway refuses", async () => {
    const state = engine()
    const seen: string[] = []
    const baseUrl = gateway(async (request) => {
      const model = ((await request.json()) as { model?: string }).model ?? ""
      seen.push(model)
      if (model === "kilo/default-embed")
        return Response.json({ error: { message: "not available" } }, { status: 404 })
      return embedding(3072)
    })
    const { runtime } = host({
      directory: await tmp(),
      indexing: { enabled: true, provider: "kilo", model: "kilo/default-embed" },
      auth: { apiKey: "kilo-token", baseUrl },
      catalog: {
        defaultModel: "kilo-default",
        models: [
          { id: "kilo/default-embed", name: "Default", dimension: 1536, scoreThreshold: 0.35 },
          { id: "kilo/large-embed", name: "Large", dimension: 3072, scoreThreshold: 0.25, note: "code" },
        ],
        aliases: { "kilo-default": "kilo/default-embed" },
      },
    })

    await settled(runtime)
    expect(state.inits[0]?.input).toMatchObject({ modelId: "kilo/large-embed", modelDimension: 3072 })
    expect(seen).toEqual(["kilo/default-embed", "kilo/large-embed"])
  })

  test("keeps the catalog default when validation fails for a non-model reason", async () => {    const state = engine()
    const seen: string[] = []
    const baseUrl = gateway(async (request) => {
      seen.push(((await request.json()) as { model?: string }).model ?? "")
      return Response.json({ error: { message: "Add credits to continue" } }, { status: 402 })
    })
    const { runtime } = host({
      directory: await tmp(),
      indexing: { enabled: true },
      auth: { apiKey: "kilo-token", baseUrl },
      catalog,
    })

    await settled(runtime)
    expect(state.inits[0]?.input).toMatchObject({ modelId: "kilo/default-embed", modelDimension: 1536 })
    expect(seen).toEqual(["kilo/default-embed"])
  })

  test("passes a valid explicit Kilo model through with its hosted dimension", async () => {
    const state = engine()
    const { runtime } = host({
      directory: await tmp(),
      indexing: { enabled: true, provider: "kilo", model: "kilo/large-embed", dimension: 99 },
      auth: { apiKey: "kilo-token" },
      catalog,
    })
    await settled(runtime)
    expect(state.inits[0]?.input).toMatchObject({ modelId: "kilo/large-embed", modelDimension: 3072, searchMinScore: 0.25 })
  })

  test("reports an error for an unsupported explicit Kilo model instead of falling back", async () => {
    const state = engine()
    const { runtime } = host({
      directory: await tmp(),
      indexing: { enabled: true, provider: "kilo", model: "custom/model" },
      auth: { apiKey: "kilo-token" },
      catalog,
    })
    expect(await settled(runtime)).toMatchObject({
      state: "Error",
      message: 'Failed to initialize: Invalid indexing.model "custom/model"',
    })
    expect(state.created).toBe(0)
  })

  test("leaves Kilo model metadata unset when the hosted catalog is unavailable", async () => {
    const state = engine()
    const { runtime } = host({
      directory: await tmp(),
      indexing: { enabled: true, provider: "kilo", model: "custom/model", dimension: 2048 },
      auth: { apiKey: "kilo-token" },
    })
    await settled(runtime)
    expect(state.inits[0]?.input.modelId).toBeUndefined()
    expect(state.inits[0]?.input.modelDimension).toBeUndefined()
  })

  test("does not default to Kilo when another provider is configured", async () => {
    const state = engine()
    const { runtime } = host({
      directory: await tmp(),
      indexing: { enabled: true, openai: { apiKey: "openai-token" } },
      auth: { apiKey: "kilo-token" },
    })
    await settled(runtime)
    expect(state.inits[0]?.input).toMatchObject({ embedderProvider: "openai", openAiKey: "openai-token" })
    expect(state.inits[0]?.input.kiloApiKey).toBeUndefined()
  })

  test("keeps a failed index queryable but releases its engine", async () => {
    const state = engine(async () => {
      throw new Error("embedder unreachable")
    })
    const { runtime } = host({ directory: await tmp(), indexing: { enabled: true, provider: "ollama" } })
    expect(await settled(runtime)).toMatchObject({ state: "Error", message: "Failed to initialize: embedder unreachable" })
    expect(state.disposed).toBe(1)
    expect(runtime.ready()).toBe(false)
    expect(await runtime.search("anything")).toEqual([])
  })

  test("reports in progress and not ready while initialization is in flight", async () => {
    const gate = Promise.withResolvers<IndexingStatus>()
    engine(() => gate.promise)
    const { runtime } = host({ directory: await tmp(), indexing: { enabled: true, provider: "ollama" } })
    await runtime.init()
    expect(await runtime.current()).toMatchObject({ state: "In Progress", message: "Indexing is initializing." })
    expect(runtime.ready()).toBe(false)
    gate.resolve(complete)
    expect(await settled(runtime)).toEqual(complete)
    expect(runtime.ready()).toBe(true)
  })

  test("does not publish an initialized status after an in-flight start is disposed", async () => {
    const gate = Promise.withResolvers<IndexingStatus>()
    engine(() => gate.promise)
    const { runtime, record } = host({ directory: await tmp(), indexing: { enabled: true, provider: "ollama" } })
    await runtime.init()
    await Bun.sleep(20)
    await runtime.dispose()
    gate.resolve(complete)
    await Bun.sleep(20)
    expect(record.published.some((status) => status.state === "Complete")).toBe(false)
  })

  test("coalesces burst progress publications", async () => {
    const state = engine()
    const { runtime, record } = host({ directory: await tmp(), indexing: { enabled: true, provider: "ollama" } })
    await settled(runtime)
    const before = record.published.length
    const progress = (processedFiles: number): IndexingStatus => ({
      state: "In Progress",
      message: "Indexing",
      processedFiles,
      totalFiles: 100,
      percent: processedFiles,
    })
    state.hooks?.status(progress(1))
    for (const count of Array.from({ length: 40 }, (_, index) => index + 2)) state.hooks?.status(progress(count))
    await Bun.sleep(400)
    const burst = record.published.slice(before)
    expect(burst.length).toBeLessThanOrEqual(3)
    expect(burst.at(-1)?.processedFiles).toBe(41)
  })

  test("retains and deduplicates warnings", async () => {
    const state = engine()
    const { runtime, record } = host({ directory: await tmp(), indexing: { enabled: true, provider: "ollama" } })
    await settled(runtime)
    const warning: IndexingWarning = { code: "qdrant.version-unavailable", message: "Failed to obtain server version." }
    state.hooks?.warning(warning)
    state.hooks?.warning({ ...warning })
    expect(await runtime.warnings()).toEqual([warning])
    expect(record.warnings).toEqual([warning])
  })

  test("retries the primary checkout lookup instead of caching a failure", async () => {
    const directory = await tmp()
    const main = await tmp()
    let calls = 0
    const { runtime } = host({
      directory,
      indexing: { enabled: true, provider: "ollama" },
      env: { KILO_PLATFORM: "vscode" },
      primary: async () => {
        calls++
        return calls === 1 ? undefined : main
      },
    })
    expect(await runtime.resolveProject()).toBe(directory)
    expect(await runtime.resolveProject()).toBe(main)
  })

  test("a failed primary lookup during startup is not cached", async () => {
    const directory = await tmp()
    const main = await tmp()
    let calls = 0
    const { runtime } = host({
      directory,
      indexing: { enabled: true, provider: "ollama" },
      env: { KILO_PLATFORM: "vscode" },
      primary: async () => {
        calls++
        return calls === 1 ? undefined : main
      },
    })
    await settled(runtime)
    expect(calls).toBe(1)
    expect(await runtime.resolveProject()).toBe(main)
  })

  test("indexes a linked worktree against the primary checkout", async () => {
    const state = engine()
    const root = await tmp()
    const main = path.join(root, "main")
    const linked = path.join(root, "linked")
    await mkdir(main)
    await $`git init -q -b main ${main}`.quiet()
    await Bun.write(path.join(main, "file.ts"), "export const value = 1\n")
    await $`git -C ${main} add -A && git -C ${main} -c user.name=t -c user.email=t@t commit -qm init`.quiet()
    await $`git -C ${main} worktree add -q ${linked}`.quiet()
    await mkdir(path.join(linked, "src"))
    const primary = (dir: string) => Effect.runPromise(primaryWorktree(dir))

    const { runtime } = host({ directory: path.join(linked, "src"), indexing: { enabled: true, provider: "ollama" }, primary })
    await settled(runtime)
    expect(state.inits[0]?.baseline).toBe(path.join(main, "src"))

    const plain = host({ directory: main, indexing: { enabled: true, provider: "ollama" }, primary })
    await settled(plain.runtime)
    expect(state.inits[1]?.baseline).toBeUndefined()
  })

  test("does not classify an ordinary directory from its pathname", async () => {
    const state = engine()
    const directory = path.join(await tmp(), ".kilo", "worktrees", "feature")
    await mkdir(directory, { recursive: true })
    const primary = (dir: string) => Effect.runPromise(primaryWorktree(dir))
    expect(await primary(directory)).toBeUndefined()
    const { runtime } = host({ directory, indexing: { enabled: true, provider: "ollama" }, primary })
    await settled(runtime)
    expect(state.inits[0]?.baseline).toBeUndefined()
  })
})
