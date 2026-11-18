import { describe, expect, test } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { createSolidPlugin } from "../script/solid-cache"

const root = path.resolve(import.meta.dir, "..")
const webview = path.join(root, "webview-ui")

// A PR panel on a worktree with no session tab must still open the file from the PR's worktree. The stub PRPanel
// invokes the open-file callback as soon as it renders, so the test covers the host the panel actually gets.
describe("PR panel file target", () => {
  test("opens from the PR worktree when no session is open", async () => {
    const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
    const aliases: Record<string, string> = {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    }
    const result = await build({
      entryPoints: [path.join(root, "test/fixtures/pr-panel-file-target.tsx")],
      bundle: true,
      conditions: ["browser"],
      external: ["happy-dom"],
      format: "esm",
      platform: "node",
      logLevel: "silent",
      loader: { ".css": "empty", ".svg": "text" },
      plugins: [
        {
          name: "pr-panel-stub",
          setup(ctx) {
            ctx.onResolve({ filter: /^\.\/PRPanel$/ }, (args) => {
              if (!args.importer.endsWith(path.join("pr", "PRPanelHost.tsx"))) return
              return { path: "pr-panel", namespace: "pr-panel-stub" }
            })
            ctx.onLoad({ filter: /.*/, namespace: "pr-panel-stub" }, () => ({
              contents:
                'export function PRPanel(props) { props.onOpenFile?.("src/hello.ts", 2); return null }',
              loader: "js",
            }))
          },
        },
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
    const file = path.join(root, `.pr-panel-file-target-${crypto.randomUUID()}.mjs`)
    await Bun.write(file, result.outputFiles[0]!.contents)
    try {
      const child = Bun.spawnSync([process.execPath, file], { cwd: webview, stdout: "pipe", stderr: "pipe" })
      expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
    } finally {
      unlinkSync(file)
    }
  })
})
