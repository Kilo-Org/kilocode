import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

for (const endpoint of ["/v1", "/v1/embeddings"]) {
  for (const mode of ["configured", "unset", "empty", "invalid", "fallback"]) {
    test(`${endpoint}: uses ${mode} document and query prompts through the indexing services`, async () => {
      const root = await mkdtemp(join(tmpdir(), "kilo-prompts-"))
      const requests: Array<{ input: string[]; dimensions?: number; prompt_name?: string }> = []
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
          const body: (typeof requests)[number] = await req.json()
          requests.push(body)
          if (body.prompt_name === "BadQuery") {
            return Response.json({ error: { message: "unknown prompt_name 'BadQuery'" } }, { status: 400 })
          }
          if (mode === "fallback" && body.dimensions !== undefined) {
            return Response.json({ error: { message: "Unsupported dimensions" } }, { status: 400 })
          }
          const vector = new Float32Array(768)
          vector.set([1])
          return Response.json({
            object: "list",
            data: body.input.map((_, index) => ({
              object: "embedding",
              index,
              embedding: Buffer.from(vector.buffer).toString("base64"),
            })),
            usage: { prompt_tokens: body.input.length, total_tokens: body.input.length },
          })
        },
      })

      try {
        // Isolate the real SDK, services and LanceDB from other files' module mocks.
        const script = `
          import assert from "node:assert/strict"
          import { IndexingConfig, toIndexingConfigInput } from "./src/config.ts"
          import { CodeIndexConfigManager } from "./src/indexing/config-manager.ts"
          import { CodeIndexServiceFactory } from "./src/indexing/service-factory.ts"
          import { CodeIndexSearchService } from "./src/indexing/search-service.ts"
          import { CodeIndexStateManager } from "./src/indexing/state-manager.ts"
          import { CacheManager } from "./src/indexing/cache-manager.ts"
          const root = ${JSON.stringify(root)}
          const mode = ${JSON.stringify(mode)}
          const input = toIndexingConfigInput(IndexingConfig.parse({
            enabled: true,
            provider: "openai-compatible",
            vectorStore: "lancedb",
            model: "embeddinggemma-2",
            dimension: 768,
            searchMinScore: 0,
            "openai-compatible": {
              baseUrl: ${JSON.stringify(`http://127.0.0.1:${server.port}${endpoint}`)},
              ...(mode === "unset" ? {} : {
                documentPrompt: mode === "empty" ? "" : "document",
                queryPrompt: mode === "empty" ? "" : mode === "invalid" ? "BadQuery" : "CodeRetrieval",
              }),
            },
          }))
          const cfg = new CodeIndexConfigManager(input)
          const factory = new CodeIndexServiceFactory(cfg, root, new CacheManager(root, root), root)
          const embedder = factory.createEmbedder()
          const validation = await factory.validateEmbedder(embedder)
          if (mode === "invalid") {
            assert.equal(validation.valid, false)
            assert.ok(validation.error)
            process.exit(0)
          }
          assert.equal(validation.valid, true, validation.error)
          // Force token-budget batching while a query uses the same embedder concurrently.
          const [batch, concurrent] = await Promise.all([
            embedder.createEmbeddings(Array.from({ length: 16 }, () => "chunk" + "x".repeat(27995))),
            embedder.createEmbeddings(["concurrent"], undefined, "query"),
          ])
          assert.equal(batch.embeddings.length, 16)
          assert.equal(concurrent.embeddings.length, 1)
          const store = factory.createVectorStore()
          try {
            await store.initialize()
            const document = await embedder.createEmbeddings(["hello"], undefined, "document")
            await store.upsertPoints([{
              id: "00000000-0000-4000-8000-000000000001",
              vector: document.embeddings.at(0),
              payload: { filePath: "fixture.ts", fileHash: "fixture", codeChunk: "hello", startLine: 1, endLine: 1 },
            }])
            await store.markIndexingComplete()
            const state = new CodeIndexStateManager()
            state.setSystemState("Indexed")
            const search = new CodeIndexSearchService(cfg, state, embedder, store)
            const results = await search.searchIndex("find hello")
            assert.equal(results.at(0)?.payload?.filePath, "fixture.ts")
          } finally {
            await store.close?.()
          }
          cfg.loadConfiguration({ ...input, openAiCompatibleQueryPrompt: "another-query" })
          const retained = factory.createVectorStore()
          try {
            assert.equal(await retained.initialize(), false)
            assert.equal(await retained.hasIndexedData(), true)
          } finally {
            await retained.close?.()
          }
          cfg.loadConfiguration({ ...input, openAiCompatibleDocumentPrompt: "another-document" })
          const rebuilt = factory.createVectorStore()
          try {
            assert.equal(await rebuilt.initialize(), true)
            assert.equal(await rebuilt.hasIndexedData(), false)
          } finally {
            await rebuilt.close?.()
          }
        `
        const child = Bun.spawn([process.execPath, "-e", script], {
          cwd: join(import.meta.dir, "../../../.."),
          stdout: "pipe",
          stderr: "pipe",
          windowsHide: true,
        })
        const gate = Promise.withResolvers<never>()
        const timer = setTimeout(() => {
          child.kill()
          gate.reject(new Error("Prompt integration subprocess timed out"))
        }, 15_000)
        const [exit, , stderr] = await Promise.race([
          Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]),
          gate.promise,
        ]).finally(() => clearTimeout(timer))
        if (exit !== 0) throw new Error(stderr)

        if (mode === "invalid") {
          expect(requests.map((body) => body.prompt_name)).toEqual(["document", "BadQuery"])
          return
        }
        const document = mode === "unset" ? undefined : mode === "empty" ? "" : "document"
        const query = mode === "unset" ? undefined : mode === "empty" ? "" : "CodeRetrieval"
        expect(requests.filter((body) => body.input.at(0)?.startsWith("chunk"))).toHaveLength(2)
        for (const body of requests) {
          const text = body.input.at(0)
          const searching = text === "concurrent" || text === "find hello"
          if (text === "test") continue
          expect(body.prompt_name).toBe(searching ? query : document)
          expect(Object.hasOwn(body, "prompt_name")).toBe(mode !== "unset")
        }
        expect(requests.filter((body) => body.input.at(0) === "test").map((body) => body.prompt_name)).toEqual(
          mode === "fallback" ? [document, document, query] : mode === "configured" ? [document, query] : [document],
        )
      } finally {
        server.stop(true)
        await rm(root, { recursive: true, force: true })
      }
    }, 20_000)
  }
}
