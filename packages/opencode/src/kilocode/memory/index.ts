/**
 * Memory system — re-exported from @kilo-code/boxes
 * Original 5-file module (types + age + paths + scan + index) → single atom
 */
export {
  MEMORY_TYPES,
  parseMemoryType,
  memoryAgeDays,
  memoryAge,
  memoryFreshnessText,
  getMemoryBaseDir,
  getMemoryDir,
  getMemoryEntrypoint,
  isMemoryPath,
  scanMemoryFiles,
  formatMemoryManifest,
  truncateEntrypoint,
  readEntrypoint,
  writeEntrypoint,
  ensureDir,
  buildPrompt,
  scan,
} from "@kilo-code/boxes/memory"
export type { MemoryType, MemoryHeader } from "@kilo-code/boxes/memory"

// Namespace wrapper for backward compatibility
import * as Mem from "@kilo-code/boxes/memory"
export const Memory = {
  scan: Mem.scan,
  buildPrompt: Mem.buildPrompt,
  readEntrypoint: Mem.readEntrypoint,
  writeEntrypoint: Mem.writeEntrypoint,
  ensureDir: Mem.ensureDir,
  scanMemoryFiles: Mem.scanMemoryFiles,
  formatMemoryManifest: Mem.formatMemoryManifest,
  truncateEntrypoint: Mem.truncateEntrypoint,
}
