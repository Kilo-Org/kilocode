import { randomBytes, timingSafeEqual } from "node:crypto"
import { realpath } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { KiloNotebook } from "@opencode/schema/kilocode/notebook"
import { FileIgnoreController } from "../autocomplete/shims/FileIgnoreController"
import { NotebookAdapter } from "./adapter"
import { NotebookError } from "./path"

const PATH = "/notebook/request"
const BODY_LIMIT = 2 * 1024 * 1024

const CODES = new Set<KiloNotebook.ErrorCode>([
  "already_exists",
  "cancelled",
  "closed",
  "disconnected",
  "execution_failed",
  "invalid_cell",
  "invalid_path",
  "no_kernel",
  "not_found",
  "stale_revision",
  "timeout",
  "unsupported",
])

type NotebookAdapterLike = Pick<NotebookAdapter, "read" | "edit" | "execute">

export interface NotebookBrokerContext {
  adapter: NotebookAdapterLike
  refresh?(): Promise<void>
  dispose(): void
}

export interface NotebookBrokerOptions {
  /** The VS Code workspace and managed worktree directories the broker serves. */
  directories: () => Iterable<string>
  create?: (directory: string) => Promise<NotebookBrokerContext>
  canonical?: (directory: string) => Promise<string>
  log?: (message: string) => void
}

function failure(error: unknown): KiloNotebook.Failure {
  const detail = error instanceof Error ? error.message : String(error)
  const message = (detail || "Notebook operation failed without an error message").slice(0, 10_000)
  if (error instanceof NotebookError && CODES.has(error.code as KiloNotebook.ErrorCode)) {
    return {
      code: error.code as KiloNotebook.ErrorCode,
      message,
      ...(error.path === undefined ? {} : { path: error.path }),
      ...(error.index === undefined ? {} : { index: error.index }),
      ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
    }
  }
  return { code: "execution_failed", message }
}

async function createContext(directory: string): Promise<NotebookBrokerContext> {
  const controller = new FileIgnoreController(directory)
  await controller.initialize()
  return {
    adapter: new NotebookAdapter(controller),
    refresh: () => controller.initialize(),
    dispose: () => controller.dispose(),
  }
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false
  const value = Buffer.from(header.slice("Bearer ".length))
  const expected = Buffer.from(token)
  return value.length === expected.length && timingSafeEqual(value, expected)
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error("Notebook request body is too large"))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function valid(value: unknown): value is KiloNotebook.Request {
  if (typeof value !== "object" || value === null) return false
  if (!("operation" in value) || !("path" in value) || !("directory" in value)) return false
  if (typeof value.directory !== "string" || typeof value.path !== "string") return false
  if (value.operation === "read") return "includeOutputs" in value && typeof value.includeOutputs === "boolean"
  if (value.operation === "edit")
    return (
      "index" in value &&
      typeof value.index === "number" &&
      "edit" in value &&
      typeof value.edit === "object" &&
      value.edit !== null
    )
  if (value.operation === "execute")
    return (
      "index" in value &&
      typeof value.index === "number" &&
      "expectedRevision" in value &&
      typeof value.expectedRevision === "string"
    )
  return false
}

function write(response: ServerResponse, status: number, value: unknown) {
  if (response.writableEnded) return
  const text = JSON.stringify(value)
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  })
  response.end(text)
}

/**
 * The extension-owned half of the notebook tools. The Kilo server reaches it over loopback with a per-run token, so
 * the tools exist only while this host passes the endpoint in the server environment, and the host keeps the editor
 * state instead of opening the files a second time.
 */
export class NotebookBroker {
  private readonly contexts = new Map<string, Promise<NotebookBrokerContext>>()
  private readonly active = new Set<AbortController>()
  private readonly create: (directory: string) => Promise<NotebookBrokerContext>
  private readonly canonical: (directory: string) => Promise<string>
  private server: Server | undefined
  private starting: Promise<{ port: number; token: string }> | undefined
  private disposed = false

  constructor(private readonly options: NotebookBrokerOptions) {
    this.create = options.create ?? createContext
    this.canonical = options.canonical ?? realpath
  }

  /** The server environment that enables the tools. The broker starts on first use. */
  async env(): Promise<Record<string, string>> {
    const { port, token } = await this.start()
    return {
      KILO_NOTEBOOK_BROKER_URL: `http://127.0.0.1:${port}`,
      KILO_NOTEBOOK_BROKER_TOKEN: token,
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const controller of this.active) controller.abort()
    this.active.clear()
    await Promise.all(
      [...this.contexts.values()].map((context) =>
        context.then(
          (value) => value.dispose(),
          () => undefined,
        ),
      ),
    )
    this.contexts.clear()
    const server = this.server
    this.server = undefined
    this.starting = undefined
    if (!server) return
    const closed = new Promise<void>((resolve) => server.close(() => resolve()))
    // An aborted request can leave its response open; closing the sockets lets the host finish shutting down.
    server.closeAllConnections()
    await closed
  }

  private start(): Promise<{ port: number; token: string }> {
    if (this.starting) return this.starting
    const starting = this.listen()
    this.starting = starting
    starting.catch(() => {
      if (this.starting === starting) this.starting = undefined
    })
    return starting
  }

  private listen(): Promise<{ port: number; token: string }> {
    return new Promise((resolve, reject) => {
      const token = randomBytes(32).toString("base64url")
      const server = createServer((request, response) => void this.handle(request, response, token))
      const fail = (error: Error) => {
        server.close()
        reject(error)
      }
      server.once("error", fail)
      server.listen(0, "127.0.0.1", () => {
        server.off("error", fail)
        const address = server.address()
        if (!address || typeof address === "string") {
          server.close()
          reject(new Error("The notebook broker has no loopback address"))
          return
        }
        this.server = server
        resolve({ port: address.port, token })
      })
    })
  }

  private async handle(request: IncomingMessage, response: ServerResponse, token: string) {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method !== "POST" || url.pathname !== PATH) return write(response, 404, { error: "Not found" })
    if (!authorized(request.headers.authorization, token)) return write(response, 401, { error: "Unauthorized" })

    const raw: string | Error = await body(request).catch((error: unknown) =>
      error instanceof Error ? error : new Error(String(error)),
    )
    if (raw instanceof Error) return write(response, raw.message.includes("too large") ? 413 : 400, { error: raw.message })

    const parsed = (() => {
      try {
        return JSON.parse(raw) as unknown
      } catch {
        return undefined
      }
    })()
    if (!valid(parsed)) return write(response, 400, { error: "Invalid notebook request" })

    if (this.disposed) return write(response, 503, { error: "The notebook host is closed" })
    const root = await this.allowed(parsed.directory)
    if (!root) {
      return write(response, 200, {
        error: {
          code: "invalid_path",
          message: "Notebook request directory is not an active VS Code workspace",
        },
      })
    }

    const controller = new AbortController()
    this.active.add(controller)
    const abort = () => {
      if (!controller.signal.aborted) controller.abort()
    }
    request.on("aborted", abort)
    response.on("close", () => {
      if (!response.writableEnded) abort()
    })

    try {
      const context = await this.context(root)
      if (this.disposed) return write(response, 503, { error: "The notebook host is closed" })
      await context.refresh?.()
      if (this.disposed || controller.signal.aborted) return
      const result = await this.dispatch(context.adapter, parsed, controller.signal)
      write(response, 200, { result })
    } catch (error) {
      if (this.disposed || controller.signal.aborted) return
      write(response, 200, { error: failure(error) })
      this.options.log?.(`request failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      this.active.delete(controller)
    }
  }

  private dispatch(adapter: NotebookAdapterLike, request: KiloNotebook.Request, signal: AbortSignal) {
    if (request.operation === "read")
      return adapter.read({ path: request.path, directory: request.directory, includeOutputs: request.includeOutputs })
    if (request.operation === "edit")
      return adapter.edit({
        path: request.path,
        directory: request.directory,
        ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision }),
        index: request.index,
        edit: request.edit,
      })
    return adapter.execute({
      path: request.path,
      directory: request.directory,
      expectedRevision: request.expectedRevision,
      index: request.index,
      signal,
    })
  }

  private async allowed(directory: string): Promise<string | undefined> {
    const root = await this.canonical(directory).catch(() => undefined)
    if (!root) return undefined
    const known = await Promise.all(
      [...this.options.directories()].map((value) => this.canonical(value).catch(() => undefined)),
    )
    return known.includes(root) ? root : undefined
  }

  private context(directory: string): Promise<NotebookBrokerContext> {
    const existing = this.contexts.get(directory)
    if (existing) return existing
    const context = this.create(directory).catch((error: unknown) => {
      this.contexts.delete(directory)
      throw error
    })
    this.contexts.set(directory, context)
    return context
  }
}
