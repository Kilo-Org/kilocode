import { describe, expect, it } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

const root = path.resolve(import.meta.dir, "../..")
const webview = path.join(root, "webview-ui")

describe("Board tool transcript rendering", () => {
  it("defers collapsed bodies and shows current routes and Markdown when opened", async () => {
    const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
    const aliases: Record<string, string> = {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    }
    const dedupe = {
      name: "solid-dedupe",
      setup(ctx: Parameters<NonNullable<Parameters<typeof build>[0]["plugins"]>[number]["setup"]>[0]) {
        ctx.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
        ctx.onResolve({ filter: /\?worker&url$/ }, (args) => ({ path: args.path, namespace: "worker-url" }))
        ctx.onLoad({ filter: /.*/, namespace: "worker-url" }, () => ({
          contents: "export default undefined",
          loader: "js",
        }))
      },
    }
    const result = await build({
      entryPoints: [path.join(root, "tests/fixtures/board-tool-render.tsx")],
      bundle: true,
      conditions: ["browser"],
      external: ["happy-dom"],
      format: "esm",
      logLevel: "silent",
      loader: { ".css": "empty", ".svg": "dataurl" },
      platform: "node",
      plugins: [dedupe, solidPlugin()],
      target: "es2022",
      write: false,
    })
    const file = path.join(root, `.board-tool-render-${crypto.randomUUID()}.mjs`)
    await Bun.write(file, result.outputFiles.at(0)!.contents)
    try {
      const child = Bun.spawnSync(["bun", file], { cwd: webview, stdout: "pipe", stderr: "pipe" })
      expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
    } finally {
      unlinkSync(file)
    }
  }, 15_000)
})
