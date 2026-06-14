import { existsSync, mkdirSync } from "fs"
import { dirname, join } from "path"
import { PERL_WASM_URL } from "@kilocode/plugin/parser-url"

const PERL_WASM_FILENAME = "tree-sitter-perl.wasm"

async function download(url: string, targetPath: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  await Bun.write(targetPath, buffer)
}

const wasmsPkgPath = require.resolve("tree-sitter-wasms/package.json")
const wasmsOutDir = join(dirname(wasmsPkgPath), "out")
const targetPath = join(wasmsOutDir, PERL_WASM_FILENAME)

if (existsSync(targetPath)) {
  process.exit(0)
}

mkdirSync(wasmsOutDir, { recursive: true })

try {
  await download(PERL_WASM_URL, targetPath)
} catch (err) {
  console.warn(`Failed to download tree-sitter-perl.wasm: ${err instanceof Error ? err.message : String(err)}`)
}
