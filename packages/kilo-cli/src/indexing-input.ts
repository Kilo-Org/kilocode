import { IndexingSchema, type IndexingConfig } from "@kilocode/indexing/config"
import { Schema } from "effect"
import { lstat } from "node:fs/promises"
import { parse, type ParseError } from "jsonc-parser"

/**
 * Reads the explicit `--indexing-config` file. Enabling indexing sends source
 * code to the configured embedding provider, so the file is an opt-in the user
 * names on the command line and never something discovered from the project.
 *
 * Failures stay deliberately opaque: an indexing configuration holds provider
 * API keys and endpoints, so no message repeats a key path, a value, or any
 * part of the file. Detail belongs in the file the caller already has open.
 */
export const INDEXING_CONFIG_MAX_BYTES = 64 * 1024

export async function readIndexingConfig(file: string): Promise<IndexingConfig> {
  if (!file.trim()) throw new Error("Indexing configuration file is required")
  const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined
    throw new Error("Indexing configuration file could not be read")
  })
  if (!stat) throw new Error("Indexing configuration file does not exist")
  if (stat.isSymbolicLink()) throw new Error("Indexing configuration file must not be a symlink")
  if (!stat.isFile()) throw new Error("Indexing configuration file must be a regular file")
  if (stat.size > INDEXING_CONFIG_MAX_BYTES) {
    throw new Error(`Indexing configuration file exceeds ${INDEXING_CONFIG_MAX_BYTES} bytes`)
  }

  const errors: ParseError[] = []
  const raw: unknown = parse(await Bun.file(file).text(), errors, { allowTrailingComma: true })
  if (errors.length) throw new Error("Indexing configuration is not valid JSON or JSONC")
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Indexing configuration must be a JSON object")
  }

  // Excess keys are rejected so a typo cannot silently disable a setting the
  // user believes is active, matching the strict v1 configuration contract.
  const decoded = Schema.decodeUnknownOption(IndexingSchema, { onExcessProperty: "error" })(raw)
  if (decoded._tag === "None") throw new Error("Indexing configuration does not match the indexing schema")
  return decoded.value
}
