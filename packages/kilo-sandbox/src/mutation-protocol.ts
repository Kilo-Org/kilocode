import type { OpenFlag } from "effect/FileSystem"

export interface Options {
  readonly flag?: OpenFlag | undefined
  readonly mode?: number | undefined
  readonly recursive?: boolean | undefined
  readonly force?: boolean | undefined
  readonly overwrite?: boolean | undefined
  readonly preserveTimestamps?: boolean | undefined
  readonly directory?: string | undefined
  readonly prefix?: string | undefined
  readonly suffix?: string | undefined
}

export type Time =
  | { readonly type: "date"; readonly value: string }
  | { readonly type: "number"; readonly value: number }

export type Operation =
  | { readonly op: "chmod"; readonly path: string; readonly mode: number }
  | { readonly op: "chown"; readonly path: string; readonly uid: number; readonly gid: number }
  | { readonly op: "copy"; readonly from: string; readonly to: string; readonly options?: Options | undefined }
  | { readonly op: "copyFile"; readonly from: string; readonly to: string }
  | { readonly op: "link"; readonly from: string; readonly to: string }
  | { readonly op: "makeDirectory"; readonly path: string; readonly options?: Options | undefined }
  | { readonly op: "makeTempDirectory"; readonly options?: Options | undefined }
  | { readonly op: "makeTempFile"; readonly options?: Options | undefined }
  | { readonly op: "remove"; readonly path: string; readonly options?: Options | undefined }
  | { readonly op: "rename"; readonly from: string; readonly to: string }
  | { readonly op: "symlink"; readonly from: string; readonly to: string }
  | { readonly op: "truncate"; readonly path: string; readonly length?: number | undefined }
  | { readonly op: "utimes"; readonly path: string; readonly atime: Time; readonly mtime: Time }
  | {
      readonly op: "writeFile"
      readonly path: string
      readonly data: string
      readonly options?: Options | undefined
    }
  | {
      readonly op: "writeFileString"
      readonly path: string
      readonly data: string
      readonly options?: Options | undefined
    }

export type BatchOperation = Exclude<Operation, { readonly op: "makeTempDirectory" | "makeTempFile" }>
export type Request = Operation | { readonly op: "batch"; readonly operations: ReadonlyArray<BatchOperation> }

export interface Failure {
  readonly name?: string | undefined
  readonly message: string
  readonly code?: string | undefined
  readonly errno?: number | undefined
  readonly syscall?: string | undefined
  readonly path?: string | undefined
  readonly dest?: string | undefined
  readonly operation?: Operation["op"] | undefined
}

export type Response =
  | { readonly ok: true; readonly value?: string | undefined }
  | { readonly ok: false; readonly error: Failure }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isFailure(value: unknown): value is Failure {
  return isObject(value) && typeof value.message === "string"
}

export function isResponse(value: unknown): value is Response {
  if (!isObject(value)) return false
  if (value.ok === false) return isFailure(value.error)
  if (value.ok !== true) return false
  return value.value === undefined || typeof value.value === "string"
}

function isOperation(value: unknown): value is Operation {
  if (!isObject(value) || typeof value.op !== "string") return false
  const path = typeof value.path === "string"
  const from = typeof value.from === "string"
  const to = typeof value.to === "string"
  switch (value.op) {
    case "chmod":
      return path && typeof value.mode === "number"
    case "chown":
      return path && typeof value.uid === "number" && typeof value.gid === "number"
    case "copy":
    case "copyFile":
    case "link":
    case "rename":
    case "symlink":
      return from && to
    case "makeDirectory":
    case "remove":
    case "truncate":
      return path
    case "makeTempDirectory":
    case "makeTempFile":
      return true
    case "utimes":
      return path && isObject(value.atime) && isObject(value.mtime)
    case "writeFile":
    case "writeFileString":
      return path && typeof value.data === "string"
    default:
      return false
  }
}

function isBatchOperation(value: unknown): value is BatchOperation {
  return isOperation(value) && value.op !== "makeTempDirectory" && value.op !== "makeTempFile"
}

export function isRequest(value: unknown): value is Request {
  if (!isObject(value) || typeof value.op !== "string") return false
  if (value.op !== "batch") return isOperation(value)
  return Array.isArray(value.operations) && value.operations.length > 0 && value.operations.every(isBatchOperation)
}

export function date(value: Date | number): Time {
  return value instanceof Date ? { type: "date", value: value.toISOString() } : { type: "number", value }
}
