import { cpSync, existsSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"

export const TREE_SITTER_WASM_DIR = "tree-sitter"

export function copyCliSidecarAssets(sourceBinaryPath: string, targetBinDir: string): boolean {
  const sourceTreeSitterDir = join(dirname(sourceBinaryPath), TREE_SITTER_WASM_DIR)
  if (!existsSync(sourceTreeSitterDir)) {
    return false
  }

  const targetTreeSitterDir = join(targetBinDir, TREE_SITTER_WASM_DIR)
  if (existsSync(targetTreeSitterDir)) {
    rmSync(targetTreeSitterDir, { recursive: true, force: true })
  }
  cpSync(sourceTreeSitterDir, targetTreeSitterDir, { recursive: true })
  return true
}
