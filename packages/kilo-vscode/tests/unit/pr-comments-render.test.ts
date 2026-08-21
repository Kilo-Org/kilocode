import { describe, expect, it } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

const ROOT = path.resolve(import.meta.dir, "../..")
const WEBVIEW = path.join(ROOT, "webview-ui")
const FIXTURE = path.join(ROOT, "tests/fixtures/pr-comments-render.tsx")

describe("PR comments", () => {
  it("renders hunks, collapses resolved threads, and sends a thread to the agent", async () => {
    const solid = path.dirname(Bun.resolveSync("solid-js/package.json", WEBVIEW))
    const aliases: Record<string, string> = {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    }
    const dedupe = {
      name: "solid-dedupe",
      setup(ctx: Parameters<NonNullable<Parameters<typeof build>[0]["plugins"]>[number]["setup"]>[0]) {
        ctx.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
        ctx.onResolve({ filter: /pierre\/worker$/ }, (args) => {
          if (args.path.includes("@pierre")) return
          return { path: path.join(WEBVIEW, "pierre-worker.ts") }
        })
        ctx.onResolve({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, () => ({
          path: "markdown-shiki-worker-url",
          namespace: "kilo-worker-url",
        }))
        ctx.onLoad({ filter: /.*/, namespace: "kilo-worker-url" }, () => ({
          contents: "export default undefined",
          loader: "js",
        }))
      },
    }
    const result = await build({
      entryPoints: [FIXTURE],
      bundle: true,
      conditions: ["browser"],
      external: ["happy-dom"],
      format: "esm",
      logLevel: "silent",
      platform: "node",
      plugins: [dedupe, solidPlugin()],
      target: "es2022",
      write: false,
    })
    const file = path.join(ROOT, `.pr-comments-render-${crypto.randomUUID()}.mjs`)
    await Bun.write(file, result.outputFiles[0]!.contents)
    const child = Bun.spawnSync(["bun", file], { cwd: WEBVIEW, stdout: "pipe", stderr: "pipe" })
    unlinkSync(file)

    const output = child.stdout.toString() + child.stderr.toString()
    expect(child.exitCode, output).toBe(0)
  })
})
