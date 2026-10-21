// Builds the extension host (Node, CommonJS) and the webview (browser, ESM with Solid JSX) into dist/.
import { transformAsync } from "@babel/core"
import path from "node:path"
import { rm } from "node:fs/promises"

const root = path.resolve(import.meta.dir, "..")
const dist = path.join(root, "dist")
await rm(dist, { recursive: true, force: true })

const solid: Bun.BunPlugin = {
  name: "solid",
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async (args) => {
      const result = await transformAsync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [["babel-preset-solid", { generate: "dom" }], ["@babel/preset-typescript", { onlyRemoveTypeImports: true }]],
      })
      return { contents: result?.code ?? "", loader: "js" }
    })
  },
}

const results = await Promise.all([
  Bun.build({
    entrypoints: [path.join(root, "src/extension.ts")],
    outdir: dist,
    target: "node",
    format: "cjs",
    external: ["vscode"],
    sourcemap: "linked",
  }),
  Bun.build({
    entrypoints: [path.join(root, "webview/main.tsx")],
    outdir: dist,
    naming: "webview.[ext]",
    target: "browser",
    format: "esm",
    conditions: ["browser", "solid"],
    plugins: [solid],
    sourcemap: "linked",
    minify: Bun.argv.includes("--minify"),
  }),
])

const failed = results.flatMap((result) => result.logs.filter((log) => log.level === "error"))
if (results.some((result) => !result.success)) {
  failed.forEach((log) => console.error(log))
  process.exit(1)
}
console.log(results.flatMap((result) => result.outputs.map((output) => path.relative(root, output.path))).join("\n"))
