import { expect, test } from "bun:test"
import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

const root = path.resolve(import.meta.dir, "../..")

test("coffee button is named and keeps cleanup retries available", async () => {
  const solid = path.dirname(Bun.resolveSync("solid-js/package.json", root))
  const result = await build({
    entryPoints: [path.join(root, "tests/fixtures/caffeination-button.tsx")],
    bundle: true,
    conditions: ["browser"],
    external: ["happy-dom"],
    format: "esm",
    platform: "node",
    loader: { ".css": "empty" },
    logLevel: "silent",
    alias: {
      "solid-js": path.join(solid, "dist/solid.js"),
      "solid-js/web": path.join(solid, "web/dist/web.js"),
      "solid-js/store": path.join(solid, "store/dist/store.js"),
    },
    plugins: [solidPlugin()],
    target: "es2022",
    write: false,
  })
  const child = Bun.spawnSync([process.execPath, "run", "-"], {
    cwd: root,
    stdin: result.outputFiles.at(0)!.contents,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  })
  expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
})
