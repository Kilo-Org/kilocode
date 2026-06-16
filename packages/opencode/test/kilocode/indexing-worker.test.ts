import { expect, test } from "bun:test"
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

test("reuses enabled workers across provider initialization errors", async () => {
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
  expect(drivers.has(engine)).toBe(true)
  expect(drivers.size).toBe(1)
})
