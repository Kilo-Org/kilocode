import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

for (const endpoint of ["/v1", "/v1/embeddings"]) {
  for (const mode of ["supported", "unsupported", "unprocessable", "structured", "mismatch", "invalid"]) {
    test(`${endpoint}: preserves configured dimensions with ${mode} endpoint`, async () => {
      const root = await mkdtemp(join(tmpdir(), "kilo-dimensions-"))
      const requests: Array<{ input: string[]; dimensions?: number }> = []
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
          const body: { input: string[]; dimensions?: number } = await req.json()
          requests.push(body)
          if (mode === "invalid") {
            return Response.json(
              { error: { message: "Invalid model", type: "invalid_request_error" } },
              { status: 400 },
            )
          }
          if (mode !== "supported" && body.dimensions !== undefined) {
            return Response.json(
              {
                error: {
                  message:
                    mode === "structured"
                      ? "Extra inputs are not permitted"
                      : "Unrecognized request argument: dimensions",
                  param: "dimensions",
                },
              },
              { status: mode === "unprocessable" ? 422 : 400 },
            )
          }
          const size = mode === "supported" ? (body.dimensions ?? 768) : mode === "mismatch" ? 768 : 4096
          const vector = new Float32Array(size).fill(0.25)
          return Response.json({
            object: "list",
            data: body.input.map((_, index) => ({
              object: "embedding",
              index,
              embedding: Buffer.from(vector.buffer).toString("base64"),
            })),
            model: "qwen3-embedding-8b",
            usage: { prompt_tokens: body.input.length, total_tokens: body.input.length },
          })
        },
      })

      try {
        // A subprocess keeps the real SDK and LanceDB isolated from module mocks in other test files.
        const script = `
          import assert from "node:assert/strict"
          import { CodeIndexConfigManager } from "./src/indexing/config-manager.ts"
          import { CodeIndexServiceFactory } from "./src/indexing/service-factory.ts"
          import { CacheManager } from "./src/indexing/cache-manager.ts"
          const root = ${JSON.stringify(root)}
          const cfg = new CodeIndexConfigManager({
            enabled: true,
            embedderProvider: "openai-compatible",
            vectorStoreProvider: "lancedb",
            modelId: "qwen3-embedding-8b",
            modelDimension: 4096,
            openAiCompatibleApiKey: "fixture-key",
            openAiCompatibleBaseUrl: ${JSON.stringify(`http://127.0.0.1:${server.port}${endpoint}`)},
          })
          const factory = new CodeIndexServiceFactory(cfg, root, new CacheManager(root, root), root)
          const embedder = factory.createEmbedder()
          const validation = await factory.validateEmbedder(embedder)
          const mode = ${JSON.stringify(mode)}
          if (mode === "mismatch" || mode === "invalid") {
            assert.equal(validation.valid, false)
            if (mode === "mismatch") {
              assert.match(validation.error, /768.*4096/)
              await assert.rejects(embedder.createEmbeddings(["hello"]), /768.*4096/)
            }
            process.exit(0)
          }
          assert.equal(validation.valid, true, validation.error)
          const store = factory.createVectorStore()
          try {
            await store.initialize()
            const document = await embedder.createEmbeddings(["hello"])
            assert.equal(document.embeddings[0].length, 4096)
            await store.upsertPoints([{
              id: "00000000-0000-4000-8000-000000000001",
              vector: document.embeddings[0],
              payload: { filePath: "fixture.ts", fileHash: "fixture", codeChunk: "hello", startLine: 1, endLine: 1 },
            }])
            const query = await embedder.createEmbeddings(["hello"])
            assert.equal(query.embeddings[0].length, 4096)
            const results = await store.search(query.embeddings[0], undefined, 0, 5)
            assert.equal(results[0]?.payload?.filePath, "fixture.ts")
          } finally {
            await store.close?.()
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
          gate.reject(new Error("Dimension validation subprocess timed out"))
        }, 15_000)
        const [exit, , stderr] = await Promise.race([
          Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]),
          gate.promise,
        ]).finally(() => clearTimeout(timer))
        if (exit !== 0) throw new Error(stderr)

        expect(requests.at(0)?.dimensions).toBe(4096)
        if (mode === "supported") {
          expect(requests).toHaveLength(3)
          expect(requests.every((req) => req.dimensions === 4096)).toBe(true)
        }
        if (mode === "unsupported" || mode === "unprocessable" || mode === "structured") {
          expect(requests).toHaveLength(4)
          expect(requests.slice(1).every((req) => req.dimensions === undefined)).toBe(true)
        }
        if (mode === "invalid") expect(requests).toHaveLength(1)
      } finally {
        server.stop(true)
        await rm(root, { recursive: true, force: true })
      }
    }, 20_000)
  }
}
