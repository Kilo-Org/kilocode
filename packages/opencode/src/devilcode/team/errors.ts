import type { ZodIssue } from "zod"

export type TeamImportErrorKind =
  | "file-not-found"
  | "json-parse-failed"
  | "envelope-invalid"
  | "version-mismatch"
  | "checksum-failed"
  | "config-invalid"

export class TeamImportError extends Error {
  readonly kind: TeamImportErrorKind
  readonly filePath?: string
  constructor(opts: { kind: TeamImportErrorKind; message?: string; filePath?: string; cause?: unknown }) {
    super(opts.message ?? `Team import failed (${opts.kind})`, { cause: opts.cause })
    this.name = "TeamImportError"
    this.kind = opts.kind
    this.filePath = opts.filePath
  }
}

export class TeamVersionMismatchError extends TeamImportError {
  readonly found: string
  readonly required: string
  constructor(opts: { found: string; required: string; filePath?: string }) {
    super({
      kind: "version-mismatch",
      message: `Team export version "${opts.found}" does not match required "${opts.required}". Upgrade Devil Code or use a compatible export.`,
      filePath: opts.filePath,
    })
    this.name = "TeamVersionMismatchError"
    this.found = opts.found
    this.required = opts.required
  }
}

export class TeamChecksumError extends TeamImportError {
  constructor(opts: { filePath?: string } = {}) {
    super({
      kind: "checksum-failed",
      message: "Team export checksum verification failed — file may be corrupted or tampered.",
      filePath: opts.filePath,
    })
    this.name = "TeamChecksumError"
  }
}

export class TeamSchemaValidationError extends TeamImportError {
  readonly issues: ZodIssue[]
  readonly layer: "envelope" | "config"
  constructor(opts: { layer: "envelope" | "config"; issues: ZodIssue[]; filePath?: string }) {
    const body = opts.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n")
    super({
      kind: opts.layer === "envelope" ? "envelope-invalid" : "config-invalid",
      message: `Team ${opts.layer} validation failed:\n${body}`,
      filePath: opts.filePath,
    })
    this.name = "TeamSchemaValidationError"
    this.issues = opts.issues
    this.layer = opts.layer
  }
}
