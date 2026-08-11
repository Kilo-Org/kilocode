import path from "path"

export function plugin(root: string): Bun.BunPlugin {
  return {
    name: "kilo-morph-ripgrep",
    setup(build) {
      build.onResolve({ filter: /^@vscode\/ripgrep$/ }, () => ({
        path: path.resolve(root, "src/kilocode/morph-ripgrep.ts"),
      }))
    },
  }
}
