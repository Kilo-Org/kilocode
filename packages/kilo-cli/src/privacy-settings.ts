import type { Layout } from "./paths"
import { preflight } from "./paths"
import { serializeConfigWrite } from "./config-write"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { chmod, lstat, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { PrivacyState } from "./privacy-rpc"

const maxDocumentBytes = 1024 * 1024
const privacyKey = "privacy_mode"
const formattingOptions = { insertSpaces: true, tabSize: 2 } as const

export interface PrivacyStore {
  read(): Promise<PrivacyState>
  set(enabled: boolean): Promise<PrivacyState>
}

export interface PrivacyStoreOptions {
  /** The isolated profile layout owned by the Kilo host. */
  readonly layout: Layout
}

/**
 * Persist the Kilo-only privacy bit in the isolated profile document. This
 * store intentionally has no project or shared-global scope.
 */
export function createPrivacyStore(options: PrivacyStoreOptions): PrivacyStore {
  return {
    read,
    set: (enabled) => serializeConfigWrite(options.layout.config, () => apply(enabled)),
  }

  async function read(): Promise<PrivacyState> {
    const document = await readDocument()
    return state(document.source, options.layout.config)
  }

  async function apply(enabled: boolean): Promise<PrivacyState> {
    const document = await readDocument()
    const before = parseDocument(document.source, options.layout.config)
    if (before[privacyKey] !== undefined && typeof before[privacyKey] !== "boolean") {
      throw new Error(`The profile privacy_mode value is not boolean: ${options.layout.config}`)
    }
    const updated = applyEdits(
      document.source,
      modify(document.source, [privacyKey], enabled, { formattingOptions }),
    )
    if (updated !== document.source) {
      parseDocument(updated, options.layout.config)
      await writeDocument(updated, document.exists)
    }
    return { enabled, scope: "profile" }
  }

  async function readDocument() {
    guard()
    const info = await lstat(options.layout.config).catch((error) => {
      if (notFound(error)) return undefined
      throw new Error(`Failed to inspect profile configuration: ${options.layout.config}`)
    })
    if (!info) return { source: "{}", exists: false }
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1)
      throw new Error(`Refusing to read non-regular profile configuration: ${options.layout.config}`)
    if (info.size > maxDocumentBytes)
      throw new Error(`Profile configuration exceeds 1 MiB: ${options.layout.config}`)
    const source = await readFile(options.layout.config, "utf8").catch(() => {
      throw new Error(`Failed to read profile configuration: ${options.layout.config}`)
    })
    return { source, exists: true }
  }

  async function writeDocument(updated: string, exists: boolean) {
    guard()
    await mkdir(path.dirname(options.layout.config), { recursive: true, mode: 0o700 })
    // Preserve a deliberate existing mode; new isolated profile files are owner-only.
    const mode = exists
      ? (await stat(options.layout.config).catch(() => {
          throw new Error(`Failed to inspect profile configuration: ${options.layout.config}`)
        })).mode & 0o777
      : 0o600
    const temporary = `${options.layout.config}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, updated, { encoding: "utf8", flag: "wx", mode: 0o600 })
      await chmod(temporary, mode)
      guard()
      await rename(temporary, options.layout.config)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  function guard() {
    try {
      preflight(options.layout)
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Profile storage failed preflight")
    }
  }
}

function state(source: string, filepath: string): PrivacyState {
  const document = parseDocument(source, filepath)
  const value = document[privacyKey]
  if (value !== undefined && typeof value !== "boolean")
    throw new Error(`The profile privacy_mode value is not boolean: ${filepath}`)
  return { enabled: value === true, scope: "profile" }
}

function parseDocument(source: string, filepath: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const parsed: unknown = parse(source, errors, { allowTrailingComma: true })
  if (errors.length || !isObject(parsed))
    throw new Error(`Profile configuration is not a JSON or JSONC object: ${filepath}`)
  return parsed
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function notFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}
