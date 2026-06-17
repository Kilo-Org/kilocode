import { Schema } from "effect"
import { HttpApiError } from "effect/unstable/httpapi"
import { MemoryRedact } from "@kilocode/kilo-memory/redact"

export class MemoryDisabledError extends Schema.TaggedErrorClass<MemoryDisabledError>()("MemoryDisabledError", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {
  override get message() {
    return this.reason
  }
}

export class MemoryInvalidInputError extends Schema.TaggedErrorClass<MemoryInvalidInputError>()(
  "MemoryInvalidInputError",
  {
    reason: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {
  override get message() {
    return this.reason
  }
}

export class MemoryStorageError extends Schema.TaggedErrorClass<MemoryStorageError>()("MemoryStorageError", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {
  override get message() {
    return this.reason
  }
}

export class MemoryRootError extends Schema.TaggedErrorClass<MemoryRootError>()("MemoryRootError", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {
  override get message() {
    return this.reason
  }
}

export class MemoryCorruptStateError extends Schema.TaggedErrorClass<MemoryCorruptStateError>()(
  "MemoryCorruptStateError",
  {
    reason: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {
  override get message() {
    return this.reason
  }
}

export class MemoryUnknownError extends Schema.TaggedErrorClass<MemoryUnknownError>()("MemoryUnknownError", {
  reason: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {
  override get message() {
    return this.reason
  }
}

export type MemoryError =
  | MemoryDisabledError
  | MemoryInvalidInputError
  | MemoryStorageError
  | MemoryRootError
  | MemoryCorruptStateError
  | MemoryUnknownError

function reason(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err)
  return MemoryRedact.text(raw.replaceAll(/\s+/g, " ").slice(0, 240)) || "unknown memory error"
}

function tag(err: unknown): MemoryError | undefined {
  if (!err || typeof err !== "object" || !("_tag" in err)) return
  const value = String(err._tag)
  if (!value.startsWith("Memory")) return
  return err as MemoryError
}

export namespace MemoryError {
  export function from(err: unknown): MemoryError {
    const known = tag(err)
    if (known) return known
    const text = reason(err)
    const lower = text.toLowerCase()
    if (lower.includes("memory is disabled")) return new MemoryDisabledError({ reason: text, cause: err })
    if (
      /\b(symlink|memory path|memory root|parent is not a directory|path is not a file|path is not a directory)\b/.test(
        lower,
      )
    ) {
      return new MemoryRootError({ reason: text, cause: err })
    }
    if (/\b(state\.json|corrupt|recover|parse error|unexpected token)\b/.test(lower)) {
      return new MemoryCorruptStateError({ reason: text, cause: err })
    }
    if (/\b(lock|eacces|eperm|enoent|eio|emfile|enospc)\b/.test(lower)) {
      return new MemoryStorageError({ reason: text, cause: err })
    }
    if (/\b(invalid|schema|zod|section|key|text|source|secret-like|malformed|reject)\b/.test(lower)) {
      return new MemoryInvalidInputError({ reason: text, cause: err })
    }
    return new MemoryUnknownError({ reason: text, cause: err })
  }

  export function message(err: unknown) {
    return from(err).message
  }

  // Keep the existing public HTTP error shape while preserving typed errors inside the Kilo runtime.
  export function toHttp(err: MemoryError) {
    return new HttpApiError.BadRequest({})
  }

  export function toToolOutput(err: unknown, action: string) {
    return `Kilo memory ${action} failed: ${message(err)}`
  }
}
