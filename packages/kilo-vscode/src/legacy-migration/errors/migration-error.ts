import type { MigrationFailure, MigrationFailureKind } from "./migration-failure"

interface ErrorLike {
  message?: unknown
  status?: unknown
  data?: unknown
  body?: unknown
  cause?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim()
    return text || undefined
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  return undefined
}

function getMessage(value: unknown) {
  if (!isObject(value)) return undefined
  return getText((value as ErrorLike).message)
}

function getStatus(value: unknown) {
  if (!isObject(value)) return undefined
  const status = (value as ErrorLike).status
  return typeof status === "number" ? String(status) : getText(status)
}

function getBody(value: unknown) {
  if (!isObject(value)) return undefined

  const body = (value as ErrorLike).body
  const text = getText(body)
  if (text) return text

  if (isObject(body)) {
    const msg = getMessage(body)
    if (msg) return msg
  }

  return undefined
}

function getData(value: unknown) {
  if (!isObject(value)) return undefined

  const data = (value as ErrorLike).data
  const text = getText(data)
  if (text) return text

  if (isObject(data)) {
    const msg = getMessage(data)
    if (msg) return msg
  }

  return undefined
}

function getCause(value: unknown) {
  if (!isObject(value)) return undefined

  const cause = (value as ErrorLike).cause
  const text = getText(cause)
  if (text) return text

  return getMessage(cause)
}

function getKind(value: unknown): MigrationFailureKind {
  const status = getStatus(value)
  if (status) return "http"
  if (getData(value) || getBody(value)) return "sdk"
  if (value instanceof Error) return "generic"
  return "unknown"
}

export function normalizeMigrationError(err: unknown): MigrationFailure {
  const kind = getKind(err)
  const message = getMessage(err) ?? getBody(err) ?? getData(err) ?? getText(err) ?? "Unknown migration error"
  const detail = [getStatus(err), getBody(err), getData(err)].filter((value) => value && value !== message).join(" - ") || undefined
  const cause = getCause(err)

  return {
    kind,
    message,
    detail,
    cause,
  }
}

export function getMigrationErrorMessage(err: unknown) {
  return normalizeMigrationError(err).message
}
