import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { IndexingWorker } from "../../src/kilocode/indexing-worker-client"
import { tmpdir } from "../fixture/fixture"

test("runs indexing engine requests in its worker", async () => {
  await using tmp = await tmpdir()
  const failures: unknown[] = []
  const engine = IndexingWorker.create(tmp.path, tmp.path, {
    status() {},
    telemetry() {},
    warning() {},
    log() {},
    failure(err) {
      failures.push(err)
    },
  })

  try {
    const status = await engine.init({ enabled: false, embedderProvider: "openai" })
    expect(status.state).toBe("Disabled")
  } finally {
    await engine.dispose()
  }

  expect(failures).toEqual([])
})

test("routes multiple directories through the shared indexing worker", async () => {
  await using first = await tmpdir()
  await using second = await tmpdir()
  const failures: unknown[] = []
  const create = (directory: string) =>
    IndexingWorker.create(directory, directory, {
      status() {},
      telemetry() {},
      warning() {},
      log() {},
      failure(err) {
        failures.push(err)
      },
    })
  const left = create(first.path)
  const right = create(second.path)

  try {
    const statuses = await Promise.all([
      left.init({ enabled: false, embedderProvider: "openai" }),
      right.init({ enabled: false, embedderProvider: "openai" }),
    ])
    expect(statuses.map((status) => status.state)).toEqual(["Disabled", "Disabled"])
  } finally {
    await Promise.all([left.dispose(), right.dispose()])
  }

  expect(failures).toEqual([])
})

test("waits for the primary index instead of scanning a worktree independently", async () => {
  await using tmp = await tmpdir()
  const main = path.join(tmp.path, "main")
  const worktree = path.join(tmp.path, "worktree")
  await mkdir(main)
  await mkdir(worktree)
  await Bun.write(path.join(worktree, "file.ts"), "export function value() { return 1 }\n")

  const requests: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      requests.push(new URL(req.url).pathname)
      const body = (await req.json()) as { input: string | string[] }
      const input = Array.isArray(body.input) ? body.input : [body.input]
      return Response.json({
        object: "list",
        model: "fixture-model",
        data: input.map((_, index) => ({ object: "embedding", index, embedding: [0.1, 0.2, 0.3] })),
        usage: { prompt_tokens: 1, total_tokens: 1 },
      })
    },
  })
  const failures: unknown[] = []
  const engine = IndexingWorker.create(worktree, tmp.path, {
    status() {},
    telemetry() {},
    warning() {},
    log() {},
    failure(err) {
      failures.push(err)
    },
  })

  try {
    const status = await engine.init(
      {
        enabled: true,
        embedderProvider: "openai-compatible",
        vectorStoreProvider: "lancedb",
        modelId: "fixture-model",
        modelDimension: 3,
        openAiCompatibleBaseUrl: `http://127.0.0.1:${server.port}/v1`,
      },
      main,
    )

    expect(status.state).toBe("Standby")
    expect(status.message).toContain("primary worktree index")
    expect(requests).toEqual(["/v1/embeddings"])
  } finally {
    await engine.dispose()
    server.stop(true)
  }

  expect(failures).toEqual([])
})

test("allows same-directory recreation while disposal is pending", async () => {
  await using tmp = await tmpdir()
  const hooks = {
    status() {},
    telemetry() {},
    warning() {},
    log() {},
    failure() {},
  }
  const first = IndexingWorker.create(tmp.path, tmp.path, hooks)
  await first.init({ enabled: false, embedderProvider: "openai" })

  const disposing = first.dispose()
  const second = IndexingWorker.create(tmp.path, tmp.path, hooks)
  const status = await second.init({ enabled: false, embedderProvider: "openai" })
  await disposing
  await second.dispose()

  expect(second).not.toBe(first)
  expect(status.state).toBe("Disabled")
})

test("releases enabled workers after provider initialization errors", async () => {
  await using tmp = await tmpdir()
  const drivers = new Set<IndexingWorker.Driver>()

  for (const _ of Array.from({ length: 3 })) {
    const failures: unknown[] = []
    const warnings: string[] = []
    const engine = IndexingWorker.create(tmp.path, tmp.path, {
      status() {},
      telemetry() {},
      warning(item) {
        warnings.push(item.code)
      },
      log() {},
      failure(err) {
        failures.push(err)
      },
    })
    drivers.add(engine)

    const err = await engine
      .init({
        enabled: true,
        embedderProvider: "ollama",
        ollamaBaseUrl: "http://127.0.0.1:1",
        modelId: "nomic-embed-text",
        modelDimension: 768,
        vectorStoreProvider: "qdrant",
        qdrantUrl: "http://127.0.0.1:1",
      })
      .then(
        () => undefined,
        (err) => err,
      )
    await engine.dispose()

    expect(err).toBeInstanceOf(Error)
    expect(warnings).toContain("qdrant.version-unavailable")
    expect(failures).toEqual([])
  }

  const engine = IndexingWorker.create(tmp.path, tmp.path, {
    status() {},
    telemetry() {},
    warning() {},
    log() {},
    failure() {},
  })
  const status = await engine.init({ enabled: false, embedderProvider: "openai" })
  await engine.dispose()

  expect(status.state).toBe("Disabled")
  expect(drivers.has(engine)).toBe(false)
  expect(drivers.size).toBe(3)
})
