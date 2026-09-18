import { expect, it } from "bun:test"
import { build } from "esbuild"
import { readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

it("isolates failing feature modules from the real Node host startup path", async () => {
  const root = path.resolve(import.meta.dir, "../..")
  const bundle = await build({
    stdin: {
      resolveDir: root,
      contents: `
        import assert from "node:assert/strict"
        import { createAnnotationHandler } from "./src/kilo-provider/annotations"
        import { createResponseLensHandler } from "./src/kilo-provider/response-lens"
        const replies = []
        const pending = Promise.withResolvers()
        let accesses = 0
        const annotations = createAnnotationHandler({
          storage: () => { accesses++; return "/synthetic-unused-storage" },
          post: (reply) => { replies.push(reply); pending.resolve() },
        })
        const lens = createResponseLensHandler({
          client: () => ({ responseLens: {} }),
          directory: () => "/synthetic-unused-project",
          enabled: () => true,
          post: (reply) => replies.push(reply),
        })
        async function verify() {
          lens.cancel()
          for (const type of ["webviewReady", "requestProviders", "sendMessage"]) {
            assert.equal(annotations.handle({ type }), false)
            assert.equal(lens.handle({ type }), false)
          }
          assert.equal(accesses, 0)
          assert.deepEqual(replies, [])
          annotations.handle({ type: "annotationRequest", action: "load", sessionID: "synthetic", requestID: "load" })
          await pending.promise
          assert.equal(replies[0].type, "annotationError")
          assert.match(replies[0].error, /injected feature module failure/)
          await lens.explain({
            type: "explainBriefly", requestId: "explain", sessionID: "synthetic", messageID: "answer",
            text: "selected text", level: "simple", context: [], model: { providerID: "test", modelID: "offline" },
          })
          assert.equal(replies[1].type, "explainBrieflyError")
          assert.match(replies[1].error, /injected feature module failure/)
          assert.equal(lens.handle({ type: "requestProviders" }), false)
          annotations.dispose()
          lens.cancel()
        }
        const timeout = setTimeout(() => { console.error("Startup isolation check timed out"); process.exitCode = 1 }, 5000)
        verify().catch((error) => { console.error(error); process.exitCode = 1 }).finally(() => clearTimeout(timeout))
      `,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    minify: true,
    target: "node22",
    write: false,
    plugins: [
      {
        name: "feature-failure-injection",
        setup(context) {
          context.onLoad({ filter: /[\\/](?:annotation-store|response-lens-references)\.ts$/ }, async (args) => ({
            contents: `throw new Error("injected feature module failure");\n${await readFile(args.path, "utf8")}`,
            loader: "ts",
            resolveDir: path.dirname(args.path),
          }))
        },
      },
    ],
  })
  const file = path.join(root, `.response-lens-startup-${crypto.randomUUID()}.cjs`)
  await writeFile(file, bundle.outputFiles[0]!.contents)
  try {
    const child = Bun.spawnSync(["node", file], { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 30_000 })
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
  } finally {
    await unlink(file)
  }
}, 60_000)
