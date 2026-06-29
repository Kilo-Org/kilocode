import { randomBytes } from "node:crypto"
import * as fs from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isRequest, type Failure, type Operation, type Request, type Response, type Time } from "./mutation-protocol"

function time(value: Time) {
  return value.type === "date" ? new Date(value.value) : value.value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function field(value: unknown, key: string) {
  if (!isObject(value)) return undefined
  return value[key]
}

function isMutationFailure(value: unknown): value is { readonly error: Failure } {
  return isObject(value) && isObject(value.error) && typeof value.error.message === "string"
}

function failure(cause: unknown, operation?: Operation["op"]): Failure {
  const error = cause instanceof Error ? cause : new Error(String(cause))
  const code = field(cause, "code")
  const errno = field(cause, "errno")
  const syscall = field(cause, "syscall")
  const path = field(cause, "path")
  const dest = field(cause, "dest")
  return {
    name: error.name,
    message: error.message,
    code: typeof code === "string" ? code : undefined,
    errno: typeof errno === "number" ? errno : undefined,
    syscall: typeof syscall === "string" ? syscall : undefined,
    path: typeof path === "string" ? path : undefined,
    dest: typeof dest === "string" ? dest : undefined,
    operation,
  }
}

async function temporary(request: Extract<Operation, { op: "makeTempDirectory" | "makeTempFile" }>) {
  const prefix = request.options?.prefix ?? ""
  const directory = request.options?.directory ? join(request.options.directory, ".") : tmpdir()
  return fs.mkdtemp(prefix ? join(directory, prefix) : directory + "/")
}

async function mutate(request: Operation): Promise<string | undefined> {
  switch (request.op) {
    case "chmod":
      await fs.chmod(request.path, request.mode)
      return undefined
    case "chown":
      await fs.chown(request.path, request.uid, request.gid)
      return undefined
    case "copy":
      await fs.cp(request.from, request.to, {
        force: request.options?.overwrite ?? false,
        preserveTimestamps: request.options?.preserveTimestamps ?? false,
        recursive: true,
      })
      return undefined
    case "copyFile":
      await fs.copyFile(request.from, request.to)
      return undefined
    case "link":
      await fs.link(request.from, request.to)
      return undefined
    case "makeDirectory":
      await fs.mkdir(request.path, {
        recursive: request.options?.recursive ?? false,
        mode: request.options?.mode,
      })
      return undefined
    case "makeTempDirectory":
      return temporary(request)
    case "makeTempFile": {
      const directory = await temporary(request)
      const name = join(directory, randomBytes(6).toString("hex") + (request.options?.suffix ?? ""))
      await fs.writeFile(name, new Uint8Array(0))
      return name
    }
    case "remove":
      await fs.rm(request.path, {
        recursive: request.options?.recursive ?? false,
        force: request.options?.force ?? false,
      })
      return undefined
    case "rename":
      await fs.rename(request.from, request.to)
      return undefined
    case "symlink":
      await fs.symlink(request.from, request.to)
      return undefined
    case "truncate":
      await fs.truncate(request.path, request.length)
      return undefined
    case "utimes":
      await fs.utimes(request.path, time(request.atime), time(request.mtime))
      return undefined
    case "writeFile":
      await fs.writeFile(request.path, Buffer.from(request.data, "base64"), request.options)
      return undefined
    case "writeFileString":
      await fs.writeFile(request.path, request.data, request.options)
      return undefined
  }
  throw new TypeError("Unsupported filesystem mutation")
}

async function read() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  if (!isRequest(value)) throw new TypeError("Invalid filesystem mutation request")
  return value
}

function apply(operation: Operation) {
  return mutate(operation).catch((cause) => Promise.reject({ error: failure(cause, operation.op) }))
}

async function execute(request: Request) {
  if (request.op !== "batch") return apply(request)
  for (const operation of request.operations) await apply(operation)
  return undefined
}

const response: Response = await read()
  .then(execute)
  .then(
    (value) => ({ ok: true, value }),
    (cause) => ({ ok: false, error: isMutationFailure(cause) ? cause.error : failure(cause) }),
  )
await new Promise<void>((resolve, reject) => {
  process.stdout.write(JSON.stringify(response), (error) => (error ? reject(error) : resolve()))
})
