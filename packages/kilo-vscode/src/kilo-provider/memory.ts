import * as vscode from "vscode"
import {
  isMemoryOperation,
  isMemoryPromptOperation,
  type MemoryOperation,
  type MemoryPromptOperation,
} from "@kilocode/kilo-memory/commands"
import { MemorySchema } from "@kilocode/kilo-memory/schema"
import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import { retry } from "../services/cli-backend/retry"
import { getErrorMessage } from "../kilo-provider-utils"

type MemorySourceFile = MemorySchema.Source
type MemoryApi = KiloClient["memory"]

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
  dir(sessionID?: string): string
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

  private serial<T>(fn: () => Promise<T>) {
    const next = this.tail.then(fn, fn)
    this.tail = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  async handle(message: Record<string, unknown>): Promise<boolean> {
    if (message.type === "requestMemory") {
      this.fetch(
        typeof message.sessionID === "string" ? message.sessionID : undefined,
        message.includeSources === true,
      ).catch((err: unknown) => console.error("[Kilo New] fetchAndSendMemory failed:", err))
      return true
    }
    if (message.type === "memoryInspect") {
      await this.inspect(typeof message.sessionID === "string" ? message.sessionID : undefined)
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
    if (message.type === "memoryPrompt") {
      const op = isMemoryPromptOperation(message.operation) ? message.operation : undefined
      if (!op) return true
      await this.prompt(op, typeof message.sessionID === "string" ? message.sessionID : undefined)
      return true
    }
    return false
  }

  fetch(sessionID?: string, includeSources = false): Promise<void> {
    return this.serial(() => this.load(sessionID, includeSources))
  }

  private async load(sessionID?: string, includeSources = false): Promise<void> {
    const directory = this.input.dir(sessionID ?? this.input.session()?.id)
    const client = this.input.client()
    if (!client) {
      const cached = this.cached.get(directory)
      if (cached && typeof cached === "object" && !Array.isArray(cached)) this.input.post({ ...cached, sessionID })
      else this.input.post({ type: "memoryLoaded", sessionID, error: "Not connected to CLI backend" })
      return
    }

    const api = memory(client)
    if (!api) {
      this.input.post({ type: "memoryLoaded", sessionID, error: "Memory unavailable in CLI backend" })
      return
    }

    try {
      const { data: status } = await retry(() => api.status({ directory }, { throwOnError: true }))
      const show = includeSources
        ? (await retry(() => api.show({ directory }, { throwOnError: true }))).data
        : undefined
      const msg = {
        type: "memoryLoaded",
        sessionID,
        status,
        ...(show ? { show } : {}),
      }
      this.cached.set(directory, msg)
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

  async prompt(value: MemoryPromptOperation, sessionID?: string): Promise<void> {
    const title = value === "remember" ? "Remember in project memory" : "Forget project memory"
    const placeHolder = value === "remember" ? "Project fact, command, or correction" : "Text to remove"
    const text = await vscode.window.showInputBox({ title, placeHolder, ignoreFocusOut: true })
    if (!text?.trim()) return
    await this.run({
      operation: value,
      sessionID,
      ...(value === "remember" ? { text: text.trim() } : { query: text.trim() }),
    })
  }

  async inspect(sessionID?: string): Promise<void> {
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
      const { data: show } = await api.show({ directory }, { throwOnError: true })
      const { data: status } = await api.status({ directory }, { throwOnError: true })
      const current = sessionID ?? this.input.session()?.id
      const startup =
        current && status.state.stats.lastInjectedSessionID === current ? status.state.stats.lastInjectedTokens : 0
      const content = [
        "# Kilo Memory",
        "",
        `Root: ${show.root}`,
        `Enabled: ${show.state.enabled ? "yes" : "no"}`,
        `Auto-save: ${show.state.autoConsolidate ? "on" : "off"}`,
        "Startup context: on",
        `Stored index tokens: ${status.index.estimatedTokens}`,
        `Startup context tokens for this session: ${startup}`,
        `Last auto-save model usage: ${status.state.stats.lastConsolidationTokens} tokens`,
        "",
        "## project.md",
        show.sources.project.trim(),
        "",
        "## environment.md",
        show.sources.environment.trim(),
        "",
        "## corrections.md",
        show.sources.corrections.trim(),
        "",
        "## index.kmem",
        show.index.trim(),
        "",
        "## items",
        show.items.trim(),
        "",
        "## decisions.jsonl",
        show.decisions.trim(),
        "",
      ].join("\n")
      await vscode.workspace
        .openTextDocument({ content, language: "markdown" })
        .then((doc) => vscode.window.showTextDocument(doc, { preview: true }))
      const msg = {
        type: "memoryLoaded",
        sessionID,
        status,
        show,
      }
      this.cached.set(directory, msg)
      this.input.post(msg)
    } catch (err) {
      console.error("[Kilo New] KiloProvider: Failed to inspect memory:", err)
      this.input.post({
        type: "memoryLoaded",
        sessionID,
        error: getErrorMessage(err) || "Failed to inspect memory",
      })
    }
  }

  run(message: KiloProviderMemoryMessage): Promise<boolean> {
    return this.serial(() => this.execute(message))
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
      const data =
        message.operation === "enable"
          ? (await api.enable({ directory }, { throwOnError: true })).data
          : message.operation === "disable"
            ? (await api.disable({ directory }, { throwOnError: true })).data
            : message.operation === "rebuild"
              ? (await api.rebuild({ directory }, { throwOnError: true })).data
              : message.operation === "purge"
                ? await this.purge(api, directory, message)
                : message.operation === "auto"
                  ? await this.auto(api, directory, message)
                  : message.operation === "remember"
                    ? await this.remember(api, directory, message)
                    : message.operation === "correct"
                      ? await this.correct(api, directory, message)
                      : await this.forget(api, directory, message)
      const refreshed = await Promise.all([
        api.status({ directory }, { throwOnError: true }),
        api.show({ directory }, { throwOnError: true }),
      ]).catch((err: unknown) => {
        console.warn("[Kilo New] Memory changed but refresh failed:", err)
        return undefined
      })
      const status = refreshed?.[0].data
      const show = refreshed?.[1].data
      const result = {
        type: "memoryOperationResult",
        operation: message.operation,
        sessionID: message.sessionID,
        ok: true,
        ...(status ? { status } : {}),
        ...(show ? { show } : {}),
        result: data,
      }
      this.input.post(result)
      if (status && show) {
        const loaded = {
          type: "memoryLoaded",
          sessionID: message.sessionID,
          status,
          show,
        }
        this.cached.set(directory, loaded)
        this.input.post(loaded)
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

  private async purge(api: MemoryApi, directory: string, message: KiloProviderMemoryMessage) {
    if (message.confirm !== true) throw new Error("Memory purge requires confirmation")
    return (await api.purge({ directory, confirm: true }, { throwOnError: true })).data
  }

  private async auto(api: MemoryApi, directory: string, message: KiloProviderMemoryMessage) {
    if (message.mode === "status") return (await api.status({ directory }, { throwOnError: true })).data
    if (message.mode === "on" || message.mode === "off") {
      return (await api.configure({ directory, autoConsolidate: message.mode === "on" }, { throwOnError: true })).data
    }
    throw new Error("Auto-save mode is required")
  }
}
