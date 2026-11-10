// A composer is mounted per worktree in the Agent Manager. Switching worktrees disposes one tree and mounts the
// next, so every toolbar icon that depends on a host reply must keep its state across the switch instead of
// blinking out and back in.
import { describe, expect, test } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { createSolidPlugin } from "../script/solid-cache"

const root = path.resolve(import.meta.dir, "..")
const webview = path.join(root, "webview-ui")

describe("prompt toolbar across worktree switches", () => {
  test("every icon keeps its state when the composer is mounted again", async () => {
    const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
    const aliases: Record<string, string> = {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    }
    const result = await build({
      entryPoints: [path.join(root, "test/fixtures/prompt-toolbar-flicker.tsx")],
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
          // The markdown tail uses a bundler worker import, which this DOM fixture never starts.
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
    const file = path.join(root, `.prompt-toolbar-flicker-${crypto.randomUUID()}.mjs`)
    await Bun.write(file, result.outputFiles[0]!.contents)
    try {
      const child = Bun.spawnSync([process.execPath, file], { cwd: webview, stdout: "pipe", stderr: "pipe" })
      expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
    } finally {
      unlinkSync(file)
    }
  })
})
