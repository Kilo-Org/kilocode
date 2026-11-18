// The main surface wiring runs in Solid effects, which the server build bun resolves by default never runs. The
// fixture is bundled with the browser build so the effects fire as they do in the webview.
import { describe, expect, test } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { createSolidPlugin } from "../script/solid-cache"

const root = path.resolve(import.meta.dir, "..")
const webview = path.join(root, "webview-ui")

describe("main surface wiring", () => {
  test("a selected session or a selection change replaces the main terminal", async () => {
    const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
    const aliases: Record<string, string> = {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    }
    const result = await build({
      entryPoints: [path.join(root, "test/fixtures/main-surface.ts")],
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
        {
          name: "worker-url",
          setup(ctx) {
            ctx.onResolve({ filter: /\?worker(&url)?$/ }, (args) => ({ path: args.path, namespace: "worker-url" }))
            ctx.onLoad({ filter: /.*/, namespace: "worker-url" }, () => ({ contents: "export default ''" }))
          },
        },
        createSolidPlugin({ root }),
      ],
      target: "es2022",
      write: false,
    })
    const file = path.join(root, `.main-surface-${crypto.randomUUID()}.mjs`)
    await Bun.write(file, result.outputFiles[0]!.contents)
    try {
      const child = Bun.spawnSync([process.execPath, file], { cwd: webview, stdout: "pipe", stderr: "pipe" })
      expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
    } finally {
      unlinkSync(file)
    }
  })
})
