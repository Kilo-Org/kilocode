import { describe, expect, test } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { createSolidPlugin } from "../script/solid-cache"

const root = path.resolve(import.meta.dir, "..")
const webview = path.join(root, "webview-ui")

describe("reusable browser view", () => {
  // The build and the child run take about 1 s locally but more than 5 s on loaded Windows runners. A timeout makes
  // Bun kill the shared esbuild service, and later esbuild tests in this process then fail with EPIPE.
  test("renders and emits commands without Agent Manager or VS Code providers", async () => {
    const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
    const aliases: Record<string, string> = {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    }
    const result = await build({
      entryPoints: [path.join(root, "test/fixtures/browser-panel-render.tsx")],
      bundle: true,
      conditions: ["browser"],
      external: ["happy-dom"],
      format: "esm",
      platform: "node",
      logLevel: "silent",
      loader: { ".css": "empty" },
      plugins: [
        {
          name: "solid-dedupe",
          setup(ctx) {
            ctx.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
          },
        },
        createSolidPlugin({ root }),
      ],
      target: "es2022",
      write: false,
    })
    const file = path.join(root, `.browser-panel-render-${crypto.randomUUID()}.mjs`)
    await Bun.write(file, result.outputFiles[0]!.contents)
    try {
      // Spawn async so a slow, loaded runner does not block the event loop. Kill a stuck child before the test
      // timeout, so it cannot outlive the run and the failure still reports its output.
      const child = Bun.spawn([process.execPath, file], { cwd: webview, stdout: "pipe", stderr: "pipe" })
      const kill = setTimeout(() => child.kill("SIGKILL"), 30_000)
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]).finally(() => clearTimeout(kill))
      expect(code, stdout + stderr).toBe(0)
    } finally {
      unlinkSync(file)
    }
  }, 60_000)
})
