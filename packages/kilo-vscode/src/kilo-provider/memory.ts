import * as vscode from "vscode"
import { isMemoryOperation, type MemoryOperation } from "@kilocode/kilo-memory/commands"
import { MemorySchema } from "@kilocode/kilo-memory/schema"
import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import { retry } from "../services/cli-backend/retry"
import { getErrorMessage } from "../kilo-provider-utils"

type MemorySourceFile = MemorySchema.Source
type MemoryApi = KiloClient["memory"]
const CACHE_LIMIT = 8
const STORED_LIMIT = 16
const NO_PROJECT = "No active project for memory. Open a file in the target folder to manage its memory."

export type KiloProviderMemoryMessage = {
  operation: MemoryOperation
  sessionID?: string
  mode?: "status" | "on" | "off"
  confirm?: boolean
  text?: string
  query?: string
  key?: string
  file?: MemorySourceFile
  section?: string
}

export type KiloProviderMemoryInput = {
  client(): KiloClient | undefined
  session(): Session | undefined
  /** Project directory for memory operations, or undefined when project scope is disabled. */
  dir(sessionID?: string): string | undefined
  post(message: unknown): void
}

function file(value: unknown): MemorySourceFile | undefined {
  return MemorySchema.source(value)
}

function operation(value: unknown): MemoryOperation | undefined {
  return isMemoryOperation(value) ? value : undefined
}

function mode(value: unknown) {
  if (value === "status" || value === "on" || value === "off") return value
  return undefined
}

function memory(client: KiloClient | undefined): MemoryApi | undefined {
  return (client as { memory?: MemoryApi } | undefined)?.memory
}

function count(text: string) {
  return text.split("\n").filter((line) => line.trim().startsWith("- ")).length
}

function stored(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const marker = line.indexOf(":: ")
      return marker === -1 ? line : line.slice(marker + 3)
    })
}

function request(input: Record<string, unknown>): { value: KiloProviderMemoryMessage } | { error: string } {
  const op = operation(input.operation)
  if (!op) return { error: "Unknown memory operation" }
  const source = file(input.file)
  if (input.file !== undefined && !source) return { error: "Invalid memory source file" }
  return {
    value: {
      operation: op,
      sessionID: typeof input.sessionID === "string" ? input.sessionID : undefined,
      mode: mode(input.mode),
      confirm: input.confirm === true,
      text: typeof input.text === "string" ? input.text : undefined,
      query: typeof input.query === "string" ? input.query : undefined,
      key: typeof input.key === "string" ? input.key : undefined,
      file: source,
      section: typeof input.section === "string" ? input.section : undefined,
    },
  }
}

export class KiloProviderMemory {
  private readonly cached = new Map<string, unknown>()
  private tail = Promise.resolve()

  constructor(private readonly input: KiloProviderMemoryInput) {}

  private cache(dir: string, msg: unknown) {
    this.cached.delete(dir)
    this.cached.set(dir, msg)
    while (this.cached.size > CACHE_LIMIT) {
      const key = this.cached.keys().next().value
      if (typeof key !== "string") return
      this.cached.delete(key)
    }
  }

  private serial<T>(fn: () => Promise<T>) {
    // this.tail is always reassigned below to a never-rejecting promise, so it
    // never settles rejected — a single fulfillment handler is sufficient.
    const next = this.tail.then(fn)
    this.tail = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  async handle(message: Record<string, unknown>): Promise<boolean> {
    if (message.type === "requestMemory") {
      this.fetch(typeof message.sessionID === "string" ? message.sessionID : undefined).catch((err: unknown) =>
        console.error("[Kilo New] fetchAndSendMemory failed:", err),
      )
      return true
    }
    if (message.type === "memoryShow") {
      await this.show(
        typeof message.sessionID === "string" ? message.sessionID : undefined,
        message.mode === "status" ? "status" : "show",
      )
      return true
    }
    if (message.type === "memoryOperation") {
      const parsed = request(message)
      if ("error" in parsed) {
        this.input.post({
          type: "memoryOperationResult",
          operation: typeof message.operation === "string" ? message.operation : "unknown",
          sessionID: typeof message.sessionID === "string" ? message.sessionID : undefined,
          ok: false,
          error: parsed.error,
        })
        return true
      }
      await this.run(parsed.value)
      return true
    }
    return false
  }

  fetch(sessionID?: string): Promise<void> {
    return this.serial(() => this.load(sessionID))
  }

  /** Resolves once the serialized operation queue has drained. */
  idle(): Promise<void> {
    return this.tail
  }

  private async load(sessionID?: string): Promise<void> {
    try {
      const directory = this.input.dir(sessionID ?? this.input.session()?.id)
      const client = this.input.client()
      if (!client) {
        const cached = directory ? this.cached.get(directory) : undefined
        if (cached && typeof cached === "object" && !Array.isArray(cached)) this.input.post({ ...cached, sessionID })
        else this.input.post({ type: "memoryLoaded", sessionID, error: "Not connected to CLI backend" })
        return
      }

      const api = memory(client)
      if (!api) {
        this.input.post({ type: "memoryLoaded", sessionID, error: "Memory unavailable in CLI backend" })
        return
      }

      if (!directory) {
        this.input.post({ type: "memoryLoaded", sessionID, error: NO_PROJECT })
        return
      }

      const { data: status } = await retry(() => api.status({ directory }, { throwOnError: true }))
      const msg = {
        type: "memoryLoaded",
        sessionID,
        status,
      }
      this.cache(directory, msg)
      this.input.post(msg)
    } catch (err) {
      console.error("[Kilo New] KiloProvider: Failed to fetch memory:", err)
      this.input.post({
        type: "memoryLoaded",
        sessionID,
        error: getErrorMessage(err) || "Failed to load memory",
      })
    }
  }

  show(sessionID?: string, mode: "status" | "show" = "show"): Promise<void> {
    return this.serial(() => this.doShow(sessionID, mode))
  }

  private async doShow(sessionID: string | undefined, mode: "status" | "show"): Promise<void> {
    const client = this.input.client()
    if (!client) {
      this.input.post({
        type: "memoryLoaded",
        sessionID,
        error: "Not connected to CLI backend",
      })
      return
    }

    const api = memory(client)

    if (!api) {
      this.input.post({
        type: "memoryLoaded",
        sessionID,
        error: "Memory unavailable in CLI backend",
      })
      return
    }

    try {
      const directory = this.input.dir(sessionID ?? this.input.session()?.id)
      if (!directory) {
        this.input.post({ type: "memoryLoaded", sessionID, error: NO_PROJECT })
        return
      }
      const [{ data: show }, { data: status }] = await Promise.all([
        retry(() => api.show({ directory }, { throwOnError: true })),
        retry(() => api.status({ directory }, { throwOnError: true })),
      ])
      const msg = {
        type: "memoryLoaded",
        sessionID,
        status,
      }
      this.cache(directory, msg)
      this.input.post(msg)
      const items = stored(show.items)
      if (mode === "show" && items.length === 0) {
        void vscode.window.showInformationMessage(
          "This project doesn't have any memory yet. It will start showing after you use Kilo.",
        )
        return
      }
      const entries: vscode.QuickPickItem[] = [
        {
          label: `${status.state.enabled ? "Enabled" : "Disabled"} · ${status.state.scope}`,
          description: status.state.autoConsolidate ? "Auto-save on" : "Auto-save off",
        },
        { label: "Storage", detail: status.root },
        {
          label: "Sources",
          description: `project.md ${count(show.sources.project)} · environment.md ${count(show.sources.environment)} · corrections.md ${count(show.sources.corrections)}`,
        },
        {
          label: "Index",
          description: `${status.index.estimatedTokens.toLocaleString()} estimated tokens`,
        },
      ]
      if (mode === "show") {
        const shown = items.slice(0, STORED_LIMIT)
        entries.push(
          {
            label: "Stored memory",
            description:
              shown.length < items.length ? `${shown.length} of ${items.length} shown` : `${shown.length} shown`,
          },
          ...shown.map((label) => ({ label })),
        )
      }
      void vscode.window.showQuickPick(entries, {
        title: mode === "show" ? "Memory" : "Memory status",
        placeHolder: mode === "show" ? "Stored project memory" : "Project memory status",
        matchOnDescription: true,
        matchOnDetail: true,
      })
    } catch (err) {
      console.error("[Kilo New] KiloProvider: Failed to show memory:", err)
      this.input.post({
        type: "memoryLoaded",
        sessionID,
        error: getErrorMessage(err) || "Failed to show memory",
      })
    }
  }

  run(message: KiloProviderMemoryMessage): Promise<boolean> {
    return this.serial(() => this.execute(message))
  }

  /**
   * Serialized status read + enable/disable, so two rapid toggles can't both
   * read the same pre-toggle state and apply the same operation twice.
   * Returns the applied operation, or undefined when it failed (the failure is
   * already posted to the webview by execute()).
   */
  toggle(sessionID?: string): Promise<MemoryOperation | undefined> {
    return this.serial(async () => {
      const client = this.input.client()
      if (!client) throw new Error("Not connected to CLI backend")
      const api = memory(client)
      if (!api) throw new Error("Memory unavailable in CLI backend")
      const directory = this.input.dir(sessionID ?? this.input.session()?.id)
      if (!directory) throw new Error(NO_PROJECT)
      const { data: status } = await retry(() => api.status({ directory }, { throwOnError: true }))
      const operation = status.state.enabled ? "disable" : "enable"
      return (await this.execute({ operation, sessionID })) ? operation : undefined
    })
  }

  private async execute(message: KiloProviderMemoryMessage): Promise<boolean> {
    const client = this.input.client()
    if (!client) {
      this.input.post({
        type: "memoryOperationResult",
        operation: message.operation,
        sessionID: message.sessionID,
        ok: false,
        error: "Not connected to CLI backend",
      })
      return false
    }

    const api = memory(client)
    if (!api) {
      this.input.post({
        type: "memoryOperationResult",
        operation: message.operation,
        sessionID: message.sessionID,
        ok: false,
        error: "Memory unavailable in CLI backend",
      })
      return false
    }

    try {
      const directory = this.input.dir(message.sessionID ?? this.input.session()?.id)
      if (!directory) {
        this.input.post({
          type: "memoryOperationResult",
          operation: message.operation,
          sessionID: message.sessionID,
          ok: false,
          error: NO_PROJECT,
        })
        return false
      }
      const data = await this.action(api, directory, message)
      const refreshed =
        message.operation === "status"
          ? { data }
          : await retry(() => api.status({ directory }, { throwOnError: true })).catch((err: unknown) => {
              console.warn("[Kilo New] Memory changed but refresh failed:", err)
              return undefined
            })
      const status = refreshed?.data
      const result = {
        type: "memoryOperationResult",
        operation: message.operation,
        sessionID: message.sessionID,
        ok: true,
        ...(status ? { status } : {}),
        result: data,
      }
      this.input.post(result)
      if (status) {
        const loaded = {
          type: "memoryLoaded",
          sessionID: message.sessionID,
          status,
        }
        this.cache(directory, loaded)
        this.input.post(loaded)
      } else {
        // Mutation succeeded but the refresh failed: drop the now-stale cached
        // entry so a later offline read doesn't report pre-mutation state.
        this.cached.delete(directory)
      }
      return true
    } catch (err) {
      console.error("[Kilo New] KiloProvider: Failed memory operation:", err)
      this.input.post({
        type: "memoryOperationResult",
        operation: message.operation,
        sessionID: message.sessionID,
        ok: false,
        error: getErrorMessage(err) || "Memory operation failed",
      })
      return false
    }
  }

  private async action(api: MemoryApi, directory: string, message: KiloProviderMemoryMessage) {
    const op = message.operation
    if (op === "enable") return (await api.enable({ directory }, { throwOnError: true })).data
    if (op === "status") return (await api.status({ directory }, { throwOnError: true })).data
    if (op === "inspect") return this.inspect(api, directory)
    if (op === "disable") return (await api.disable({ directory }, { throwOnError: true })).data
    if (op === "rebuild") return (await api.rebuild({ directory }, { throwOnError: true })).data
    if (op === "purge") return this.purge(api, directory, message)
    if (op === "auto") return this.auto(api, directory, message)
    if (op === "remember") return this.remember(api, directory, message)
    if (op === "correct") return this.correct(api, directory, message)
    return this.forget(api, directory, message)
  }

  private async remember(api: MemoryApi, directory: string, message: KiloProviderMemoryMessage) {
    const text = message.text?.trim()
    if (!text) throw new Error("Memory text is required")
    return (
      await api.remember(
        {
          directory,
          text,
          key: message.key,
          file: message.file,
          section: message.section,
          sessionID: message.sessionID,
        },
        { throwOnError: true },
      )
    ).data
  }

  private async correct(api: MemoryApi, directory: string, message: KiloProviderMemoryMessage) {
    const text = message.text?.trim()
    if (!text) throw new Error("Correction text is required")
    return (
      await api.correct(
        {
          directory,
          text,
          key: message.key,
          sessionID: message.sessionID,
        },
        { throwOnError: true },
      )
    ).data
  }

  private async forget(api: MemoryApi, directory: string, message: KiloProviderMemoryMessage) {
    const query = message.query?.trim()
    if (!query) throw new Error("Forget query is required")
    return (await api.forget({ directory, query, sessionID: message.sessionID }, { throwOnError: true })).data
  }

  private async inspect(api: MemoryApi, directory: string) {
    const { data: status } = await retry(() => api.status({ directory }, { throwOnError: true }))
    if (!status.state.enabled) throw new Error("Memory is disabled. Run /memory on first.")
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(status.root))
    return status
  }

  private async purge(api: MemoryApi, directory: string, message: KiloProviderMemoryMessage) {
    if (message.confirm !== true) throw new Error("Memory purge requires confirmation")
    return (await api.purge({ directory, confirm: true }, { throwOnError: true })).data
  }

  private async auto(api: MemoryApi, directory: string, message: KiloProviderMemoryMessage) {
    if (message.mode === "status") return (await retry(() => api.status({ directory }, { throwOnError: true }))).data
    if (message.mode === "on" || message.mode === "off") {
      return (await api.configure({ directory, autoConsolidate: message.mode === "on" }, { throwOnError: true })).data
    }
    throw new Error("Auto-save mode is required")
  }
}
