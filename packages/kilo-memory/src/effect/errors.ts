import { Schema } from "effect"
import { MemoryRedact } from "../capture/redact"

// Typed API error shapes so the SDK / OpenAPI reflect the real contract.
export class MemoryApiClientError extends Schema.ErrorClass<MemoryApiClientError>("MemoryApiClientError")(
  {
    name: Schema.Literal("MemoryApiClientError"),
    data: Schema.Struct({ code: Schema.String, message: Schema.String }),
  },
  { httpApiStatus: 400 },
) {}

export class MemoryApiServerError extends Schema.ErrorClass<MemoryApiServerError>("MemoryApiServerError")(
  {
    name: Schema.Literal("MemoryApiServerError"),
    data: Schema.Struct({ code: Schema.String, message: Schema.String }),
  },
  { httpApiStatus: 503 },
) {}

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

  // Map typed taxonomy to HTTP error contract; redaction already applied via .message.
  export function toHttp(err: MemoryError): MemoryApiClientError | MemoryApiServerError {
    const msg = err.message
    switch (err._tag) {
      case "MemoryDisabledError":
        return new MemoryApiClientError({
          name: "MemoryApiClientError",
          data: { code: "memory_disabled", message: msg },
        })
      case "MemoryInvalidInputError":
        return new MemoryApiClientError({
          name: "MemoryApiClientError",
          data: { code: "memory_invalid_input", message: msg },
        })
      case "MemoryRootError":
        return new MemoryApiClientError({
          name: "MemoryApiClientError",
          data: { code: "memory_root_error", message: msg },
        })
      case "MemoryStorageError":
        return new MemoryApiServerError({
          name: "MemoryApiServerError",
          data: { code: "memory_storage_error", message: msg },
        })
      case "MemoryCorruptStateError":
        return new MemoryApiServerError({
          name: "MemoryApiServerError",
          data: { code: "memory_corrupt_state", message: msg },
        })
      default:
        return new MemoryApiServerError({ name: "MemoryApiServerError", data: { code: "memory_error", message: msg } })
    }
  }

  export function toToolOutput(err: unknown, action: string) {
    return `Kilo memory ${action} failed: ${message(err)}`
  }
}
