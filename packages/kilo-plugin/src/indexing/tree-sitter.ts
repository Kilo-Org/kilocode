import { existsSync, readdirSync } from "node:fs"
import path from "path"

// The build puts the tree-sitter grammars next to the executable in the platform
// package (`bin/tree-sitter`). The npm launcher copies only the executable into its own `bin`, so there the engine
// would not find them: point it at the platform package, nested below the launcher or hoisted beside it.
export function wasmDirectory(exec = process.execPath, env: Record<string, string | undefined> = process.env) {
  if (env.KILO_TREE_SITTER_WASM_DIR) return env.KILO_TREE_SITTER_WASM_DIR
  const bin = path.dirname(exec)
  if (existsSync(path.join(bin, "tree-sitter", "tree-sitter.wasm"))) return undefined
  const scopes = [path.join(bin, "..", "node_modules", "@kilocode"), path.join(bin, "..", "..")]
  return scopes
    .flatMap((scope) => {
      const names = existsSync(scope) ? readdirSync(scope).filter((name) => name.startsWith("cli-")) : []
      return names.map((name) => path.join(scope, name, "bin", "tree-sitter"))
    })
    .find((dir) => existsSync(path.join(dir, "tree-sitter.wasm")))
}
