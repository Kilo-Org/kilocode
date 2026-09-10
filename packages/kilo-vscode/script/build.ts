import { build } from "esbuild"
import path from "node:path"
import { cp, rm } from "node:fs/promises"

export async function buildExtension() {
  const root = path.resolve(import.meta.dir, "..")
  await rm(path.join(root, "dist/web"), { recursive: true, force: true })
  await rm(path.join(root, "dist/extension-host.cjs"), { force: true })
  await rm(path.join(root, "dist/existing-extension.cjs"), { force: true })
  await rm(path.join(root, "dist/existing-extension.cjs.map"), { force: true })
  await build({
    entryPoints: [path.join(root, "src/extension.ts")],
    outfile: path.join(root, "dist/extension.cjs"),
    bundle: true,
    platform: "node",
    plugins: [
      {
        name: "tree-sitter-node-runtime",
        setup(context) {
          context.onResolve({ filter: /^web-tree-sitter$/ }, () => ({ path: require.resolve("web-tree-sitter") }))
        },
      },
    ],
    format: "cjs",
    external: ["vscode", "web-tree-sitter/tree-sitter.wasm"],
    sourcemap: "external",
  })
  await cp(require.resolve("web-tree-sitter/tree-sitter.wasm"), path.join(root, "dist/tree-sitter.wasm"))
  await cp(
    path.dirname(require.resolve("tree-sitter-wasms/out/tree-sitter-typescript.wasm")),
    path.join(root, "dist"),
    { recursive: true },
  )
  await cp(path.join(root, "src/services/autocomplete/continuedev/tree-sitter"), path.join(root, "dist/tree-sitter"), {
    recursive: true,
  })
  const web = Bun.spawn([process.execPath, path.join(root, "script/build-existing-web.ts")], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await web.exited) !== 0) throw new Error("Unable to build the original Kilo webviews")
}

if (import.meta.main) await buildExtension()
