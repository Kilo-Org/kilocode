import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { rm } from "node:fs/promises"
import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

const root = path.resolve(import.meta.dir, "../..")
const file = path.join(root, `.markdown-worker-recovery-${crypto.randomUUID()}.mjs`)

beforeAll(async () => {
  await build({
    entryPoints: [path.join(import.meta.dir, "markdown-worker-recovery.fixture.tsx")],
    bundle: true,
    conditions: ["browser"],
    external: ["happy-dom"],
    format: "esm",
    platform: "node",
    plugins: [
      {
        name: "worker-url",
        setup(ctx) {
          ctx.onResolve({ filter: /\?worker&url$/ }, () => ({ path: "worker-url", namespace: "fixture" }))
          ctx.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: 'export default "markdown-worker.js"',
          }))
        },
      },
      solidPlugin(),
    ],
    target: "es2022",
    outfile: file,
    logLevel: "silent",
  })
}, 20_000)

afterAll(() => rm(file, { force: true }))

describe("Markdown worker recovery", () => {
  for (const mode of ["unavailable", "success"]) {
    it(
      mode === "unavailable"
        ? "colors unchanged settled code after worker construction fails"
        : "retains successful worker highlights on settle",
      async () => {
        // Separate processes keep DOM globals and the worker's disabled state out of other tests.
        const child = Bun.spawn([process.execPath, file, mode], {
          cwd: root,
          stdout: "pipe",
          stderr: "pipe",
        })
        const output = (await new Response(child.stdout).text()) + (await new Response(child.stderr).text())
        expect(await child.exited, output).toBe(0)
      },
      20_000,
    )
  }
})
