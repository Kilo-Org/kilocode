import { describe, expect, test } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { createSolidPlugin } from "../script/solid-cache"

const root = path.resolve(import.meta.dir, "..")
const webview = path.join(root, "webview-ui")

describe("display preview", () => {
  test("renders the sample turn with the rich content providers and the execute tool", async () => {
    const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
    const aliases: Record<string, string> = {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    }
    const result = await build({
      entryPoints: [path.join(root, "test/fixtures/display-preview-render.tsx")],
      bundle: true,
      conditions: ["browser"],
      external: ["happy-dom"],
      format: "esm",
      platform: "node",
      logLevel: "silent",
      loader: { ".css": "empty", ".svg": "text" },
      plugins: [
        {
          name: "solid-dedupe",
          setup(ctx) {
            ctx.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
          },
        },
        // The message-part stack loads its workers through Vite-only `?worker&url` imports. The preview never
        // highlights code, so an empty URL keeps the imports resolvable without starting a worker.
        {
          name: "worker-url",
          setup(ctx) {
            ctx.onResolve({ filter: /\?worker&url$/ }, (args) => ({ path: args.path, namespace: "worker-url" }))
            ctx.onLoad({ filter: /.*/, namespace: "worker-url" }, () => ({
              contents: 'export default ""',
              loader: "js",
            }))
          },
        },
        createSolidPlugin({ root }),
      ],
      target: "es2022",
      write: false,
    })
    const file = path.join(root, `.display-preview-render-${crypto.randomUUID()}.mjs`)
    await Bun.write(file, result.outputFiles[0]!.contents)
    try {
      const child = Bun.spawnSync([process.execPath, file], { cwd: webview, stdout: "pipe", stderr: "pipe" })
      expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
    } finally {
      unlinkSync(file)
    }
  }, 15_000)
})
