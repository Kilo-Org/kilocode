import { expect, it } from "bun:test"
import { unlinkSync } from "node:fs"
import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

it("requires explicit worktree confirmation and preserves activity and dismissal", async () => {
  const root = path.resolve(import.meta.dir, "../..")
  const webview = path.join(root, "webview-ui")
  const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
  const result = await build({
    entryPoints: [path.join(root, "tests/fixtures/worktree-finish.tsx")],
    bundle: true,
    conditions: ["browser"],
    external: ["happy-dom"],
    format: "esm",
    loader: { ".css": "empty" },
    logLevel: "silent",
    platform: "node",
    alias: {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    },
    plugins: [solidPlugin()],
    target: "es2022",
    write: false,
  })
  const file = path.join(root, `.worktree-finish-${crypto.randomUUID()}.mjs`)
  await Bun.write(file, result.outputFiles.at(0)!.contents)
  try {
    const child = Bun.spawnSync(["bun", file], { cwd: webview, stdout: "pipe", stderr: "pipe" })
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
  } finally {
    unlinkSync(file)
  }
})
