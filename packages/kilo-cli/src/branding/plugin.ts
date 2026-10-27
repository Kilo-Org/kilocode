import type { BunPlugin } from "bun"
import path from "node:path"
import { KiloBranding } from "./text"

export const brandingPlugin: BunPlugin = {
  name: "kilo-branding",
  setup(build) {
    build.onLoad({ filter: /[/\\]packages[/\\]tui[/\\]src[/\\]logo\.ts$/ }, async (args) => {
      const source = await Bun.file(args.path).text()
      const { parseAsync } = await import("@babel/core")
      const parsed = await parseAsync(source, {
        filename: args.path,
        sourceType: "module",
        configFile: false,
        babelrc: false,
        parserOpts: { plugins: ["typescript"] },
      })
      const declaration = parsed?.program.body.find((node) => {
        if (node.type !== "ExportNamedDeclaration" || node.declaration?.type !== "VariableDeclaration") return false
        if (node.declaration.kind !== "const" || node.declaration.declarations.length !== 1) return false
        const variable = node.declaration.declarations[0]
        return (
          variable.id.type === "Identifier" && variable.id.name === "logo" && variable.init?.type === "ObjectExpression"
        )
      })
      if (typeof declaration?.start !== "number" || typeof declaration.end !== "number")
        throw new Error("Kilo logo no longer matches the upstream module")
      return {
        loader: "ts",
        contents:
          source.slice(0, declaration.start) +
          `export { logo, compact, widths, palette } from ${JSON.stringify(path.join(import.meta.dir, "logo-art.ts"))}\n` +
          source.slice(declaration.end),
      }
    })
    const files = Object.keys(KiloBranding.replacements)
      .map((file) => file.replaceAll(".", "\\.").replaceAll("/", "[/\\\\]"))
      .join("|")
    build.onLoad({ filter: new RegExp(`[/\\\\]packages[/\\\\](?:${files})$`) }, async (args) => {
      const key = args.path.replaceAll("\\", "/").split("/packages/").at(-1) ?? args.path
      const contents = KiloBranding.transform(args.path, await Bun.file(args.path).text())
      if (!args.path.endsWith(".tsx")) return { loader: "ts", contents }
      const { transformAsync } = await import("@babel/core")
      const solid = await import("babel-preset-solid")
      const typescript = await import("@babel/preset-typescript")
      const result = await transformAsync(contents, {
        filename: args.path,
        configFile: false,
        babelrc: false,
        plugins: [],
        presets: [[solid.default, { moduleName: "@opentui/solid", generate: "universal" }], [typescript.default]],
      })
      if (!result?.code) throw new Error(`Could not compile Kilo branding for ${key}`)
      return { loader: "js", contents: result.code }
    })
  },
}
