import { expect } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

export async function fixture(name: string) {
  const root = path.resolve(import.meta.dir, "../..")
  const webview = path.join(root, "webview-ui")
  const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
  const aliases: Record<string, string> = {
    "solid-js": path.join(solid, "dist/solid.js"),
    "solid-js/web": path.join(solid, "web/dist/web.js"),
    "solid-js/store": path.join(solid, "store/dist/store.js"),
  }
  const result = await build({
    entryPoints: [path.join(import.meta.dir, `${name}.tsx`)],
    bundle: true,
    conditions: ["browser"],
    external: ["happy-dom"],
    format: "esm",
    loader: { ".css": "empty" },
    logLevel: "silent",
    platform: "node",
    target: "es2022",
    write: false,
    plugins: [
      {
        name: "browser-fixture",
        setup(ctx) {
          ctx.onResolve({ filter: /^solid-js(\/web|\/store)?$/ }, (args) => ({ path: aliases[args.path] }))
          ctx.onResolve({ filter: /pierre\/worker$/ }, (args) =>
            args.path.includes("@pierre") ? undefined : { path: path.join(webview, "pierre-worker.ts") },
          )
          ctx.onResolve({ filter: /markdown-shiki\.worker\.ts\?worker&url$/ }, () => ({
            path: "worker",
            namespace: "fixture",
          }))
          ctx.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export default undefined",
            loader: "js",
          }))
        },
      },
      solidPlugin(),
    ],
  })
  const file = path.join(root, `.${name}-${crypto.randomUUID()}.mjs`)
  await Bun.write(file, result.outputFiles[0]!.contents)
  try {
    const child = Bun.spawnSync(["bun", file], { cwd: webview, stdout: "pipe", stderr: "pipe" })
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
  } finally {
    unlinkSync(file)
  }
}
