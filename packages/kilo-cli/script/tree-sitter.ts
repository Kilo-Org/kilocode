import { copyFile, mkdir, readdir } from "fs/promises"
import path from "path"

// Copies the web-tree-sitter runtime and the language grammars into `<bin>/tree-sitter`. The indexing engine resolves
// grammars from the executable's directory (`packages/kilo-indexing/src/tree-sitter/languageParser.ts`), so the
// compiled `kilo2` parses source files without node_modules.
export async function copyTreeSitterWasms(bin: string) {
  const engine = path.dirname(Bun.resolveSync("@kilocode/kilo-indexing/engine", import.meta.dir))
  const runtime = Bun.resolveSync("web-tree-sitter/tree-sitter.wasm", engine)
  const languages = path.join(path.dirname(Bun.resolveSync("tree-sitter-wasms/package.json", engine)), "out")
  const target = path.join(bin, "tree-sitter")
  await mkdir(target, { recursive: true })
  await copyFile(runtime, path.join(target, "tree-sitter.wasm"))
  const files = (await readdir(languages)).filter((file) => file.endsWith(".wasm"))
  await Promise.all(files.map((file) => copyFile(path.join(languages, file), path.join(target, file))))
  console.log(`copied ${files.length + 1} tree-sitter wasm files to ${target}`)
}
