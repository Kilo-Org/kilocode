import { describe, expect, it } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

const root = path.resolve(import.meta.dir, "../..")
const webview = path.join(root, "webview-ui")

describe("Response Lens mounted components", () => {
  it.each(["annotation-components", "response-lens-components"])(
    "runs %s production wiring",
    async (fixture) => {
      const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
      const aliases: Record<string, string> = {
        "solid-js": path.join(solid, "dist/solid.js"),
        "solid-js/web": path.join(solid, "web/dist/web.js"),
        "solid-js/store": path.join(solid, "store/dist/store.js"),
      }
      const result = await build({
        entryPoints: [path.join(root, `tests/fixtures/${fixture}.tsx`)],
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
            setup(context) {
              context.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
              context.onResolve({ filter: /\?worker&url$/ }, (args) => ({ path: args.path, namespace: "worker-url" }))
              context.onLoad({ filter: /.*/, namespace: "worker-url" }, () => ({
                contents: "export default undefined",
                loader: "js",
              }))
            },
          },
          solidPlugin(),
        ],
        target: "es2022",
        write: false,
      })
      const file = path.join(root, `.annotation-components-${crypto.randomUUID()}.mjs`)
      await Bun.write(file, result.outputFiles[0]!.contents)
      try {
        const child = Bun.spawnSync([process.execPath, file], { cwd: webview, stdout: "pipe", stderr: "pipe" })
        expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
      } finally {
        unlinkSync(file)
      }
    },
    60_000,
  )
})
