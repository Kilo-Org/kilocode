// The project memory host of a webview, ported from v1's kilo-provider/memory.ts. Status reads, operations and the
// Quick Pick overview go through the `kilocode.memory` RPC of the server Location; `inspect` reveals the memory
// folder in the OS. Memory events reach the webview from the RPC directly (context/memory.tsx).
import * as vscode from "vscode"
import { OpenCode } from "@opencode/client"
import { KiloMemoryRpc } from "@opencode/schema/kilocode/memory"
import { getErrorMessage } from "../agent-manager/errors"
import { local } from "../local"
import type { MemoryOperationMessage, ToWebview } from "../protocol"
import type { Manager } from "../server"
import { memoryCopy, type MemoryCopy } from "./memory-copy"

const STORED_LIMIT = 16

export type MemoryApi = {
  status(input: { sessionID?: string }): Promise<KiloMemoryRpc.Status>
  show(): Promise<KiloMemoryRpc.Show>
  enable(): Promise<KiloMemoryRpc.Changed>
  disable(): Promise<KiloMemoryRpc.Settings>
  configure(input: { autoConsolidate?: boolean; verbose?: boolean }): Promise<KiloMemoryRpc.Settings>
  rebuild(): Promise<KiloMemoryRpc.Changed>
  remember(input: {
    text: string
    key?: string
    file?: KiloMemoryRpc.Source
    section?: string
    sessionID?: string
  }): Promise<KiloMemoryRpc.Operation>
  correct(input: { text: string; key?: string; sessionID?: string }): Promise<KiloMemoryRpc.Operation>
  forget(input: { query: string; sessionID?: string }): Promise<KiloMemoryRpc.Operation>
  purge(): Promise<{ root: string; purged: boolean }>
}

export type KiloProviderMemoryInput = {
  /** The memory RPC of the project, or undefined without a project folder. */
  api(): Promise<MemoryApi | undefined>
  post(message: ToWebview): void
  /** Test seam: reveals a folder in the OS file manager. */
  reveal?: (root: string) => Thenable<unknown>
  /** Test seam: the Quick Pick and information message. */
  pick?: (items: vscode.QuickPickItem[], options: vscode.QuickPickOptions) => Thenable<unknown>
  info?: (message: string) => Thenable<unknown>
  /** Test seam: the localized host copy. */
  copy?: MemoryCopy
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

class MemoryFailure extends Error {}

export class KiloProviderMemory {
  private tail = Promise.resolve()

  constructor(private readonly input: KiloProviderMemoryInput) {}

  private get copy() {
    return this.input.copy ?? memoryCopy()
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

  /** Handles a memory message from the webview; false when the message is not one. */
  handle(message: { type: string } & Record<string, unknown>): boolean {
    if (message.type === "requestMemory") {
      void this.fetch(typeof message.sessionID === "string" ? message.sessionID : undefined)
      return true
    }
    if (message.type === "memoryShow") {
      void this.show(
        typeof message.sessionID === "string" ? message.sessionID : undefined,
        message.mode === "status" ? "status" : "show",
      )
      return true
    }
    if (message.type === "memoryOperation") {
      void this.run(message as unknown as MemoryOperationMessage)
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

  private async connect() {
    const api = await this.input.api().catch((err: unknown) => {
      throw new MemoryFailure(this.failure(err, this.copy.t("memory.host.error.notConnected")))
    })
    if (!api) throw new MemoryFailure(this.copy.t("memory.host.error.noProject"))
    return api
  }

  private async load(sessionID?: string): Promise<void> {
    try {
      const api = await this.connect()
      const status = await api.status({ sessionID })
      this.input.post({ type: "memoryLoaded", sessionID, status })
    } catch (err) {
      console.error("[Kilo] Failed to fetch memory:", err)
      this.input.post({
        type: "memoryLoaded",
        sessionID,
        error: this.failure(err, this.copy.t("memory.host.error.load")),
      })
    }
  }

  show(sessionID?: string, mode: "status" | "show" = "show"): Promise<void> {
    return this.serial(() => this.doShow(sessionID, mode))
  }

  private async doShow(sessionID: string | undefined, mode: "status" | "show"): Promise<void> {
    const t = this.copy.t
    try {
      const api = await this.connect()
      const [show, status] = await Promise.all([api.show(), api.status({ sessionID })])
      this.input.post({ type: "memoryLoaded", sessionID, status })
      const items = stored(show.items)
      if (mode === "show" && items.length === 0) {
        void (this.input.info ?? vscode.window.showInformationMessage)(t("memory.host.show.empty"))
        return
      }
      const entries: vscode.QuickPickItem[] = [
        {
          label: `${status.state.enabled ? t("memory.host.show.enabled") : t("memory.host.show.disabled")} · ${status.state.scope}`,
          description: status.state.autoConsolidate
            ? t("memory.host.show.autoSaveOn")
            : t("memory.host.show.autoSaveOff"),
        },
        { label: t("memory.host.show.storage"), detail: status.root },
        {
          label: t("memory.host.show.sources"),
          description: `project.md ${count(show.sources.project)} · environment.md ${count(show.sources.environment)} · corrections.md ${count(show.sources.corrections)}`,
        },
        {
          label: t("memory.host.show.index"),
          description: t("memory.host.show.tokens", { tokens: status.index.estimatedTokens.toLocaleString() }),
        },
      ]
      if (mode === "show") {
        const shown = items.slice(0, STORED_LIMIT)
        entries.push(
          {
            label: t("memory.host.show.stored"),
            description:
              shown.length < items.length
                ? t("memory.host.show.shownOf", { shown: shown.length, total: items.length })
                : t("memory.host.show.shown", { shown: shown.length }),
          },
          ...shown.map((label) => ({ label })),
        )
      }
      void (this.input.pick ?? vscode.window.showQuickPick)(entries, {
        title: mode === "show" ? t("memory.host.show.title") : t("memory.host.show.statusTitle"),
        placeHolder: mode === "show" ? t("memory.host.show.placeholder") : t("memory.host.show.statusPlaceholder"),
        matchOnDescription: true,
        matchOnDetail: true,
      })
    } catch (err) {
      console.error("[Kilo] Failed to show memory:", err)
      this.input.post({ type: "memoryLoaded", sessionID, error: this.failure(err, t("memory.host.error.show")) })
    }
  }

  run(message: MemoryOperationMessage): Promise<boolean> {
    return this.serial(() => this.execute(message))
  }

  /**
   * Serialized status read + enable/disable, so two rapid toggles can't both
   * read the same pre-toggle state and apply the same operation twice.
   */
  toggle(sessionID?: string): Promise<"enable" | "disable" | undefined> {
    return this.serial(async () => {
      const api = await this.connect()
      const status = await api.status({ sessionID })
      const operation = status.state.enabled ? "disable" : "enable"
      return (await this.execute({ type: "memoryOperation", operation, sessionID })) ? operation : undefined
    })
  }

  private async execute(message: MemoryOperationMessage): Promise<boolean> {
    try {
      const api = await this.connect()
      const data = await this.action(api, message)
      const refreshed =
        message.operation === "status"
          ? (data as KiloMemoryRpc.Status)
          : await api.status({ sessionID: message.sessionID }).catch((err: unknown) => {
              console.warn("[Kilo] Memory changed but refresh failed:", err)
              return undefined
            })
      this.input.post({
        type: "memoryOperationResult",
        operation: message.operation,
        sessionID: message.sessionID,
        ok: true,
        ...(refreshed ? { status: refreshed } : {}),
      })
      if (refreshed) this.input.post({ type: "memoryLoaded", sessionID: message.sessionID, status: refreshed })
      return true
    } catch (err) {
      console.error("[Kilo] Failed memory operation:", err)
      this.input.post({
        type: "memoryOperationResult",
        operation: message.operation,
        sessionID: message.sessionID,
        ok: false,
        error: this.failure(err, this.copy.t("memory.host.error.operation")),
      })
      return false
    }
  }

  private async action(api: MemoryApi, message: MemoryOperationMessage): Promise<unknown> {
    const op = message.operation
    if (op === "enable") return api.enable()
    if (op === "status") return api.status({ sessionID: message.sessionID })
    if (op === "inspect") return this.inspect(api, message.sessionID)
    if (op === "disable") return api.disable()
    if (op === "rebuild") return api.rebuild()
    if (op === "purge") {
      if (message.confirm !== true) throw new MemoryFailure(this.copy.t("memory.host.error.invalidInput"))
      return api.purge()
    }
    if (op === "auto") {
      if (message.mode === "status") return api.status({ sessionID: message.sessionID })
      if (message.mode === "on" || message.mode === "off")
        return api.configure({ autoConsolidate: message.mode === "on" })
      throw new MemoryFailure(this.copy.t("memory.host.error.invalidInput"))
    }
    if (op === "forget") {
      const query = message.query?.trim()
      if (!query) throw new MemoryFailure(this.copy.t("memory.host.error.invalidInput"))
      return api.forget({ query, sessionID: message.sessionID })
    }
    const text = message.text?.trim()
    if (!text) throw new MemoryFailure(this.copy.t("memory.host.error.invalidInput"))
    if (op === "correct") return api.correct({ text, key: message.key, sessionID: message.sessionID })
    return api.remember({
      text,
      key: message.key,
      file: message.file,
      section: message.section,
      sessionID: message.sessionID,
    })
  }

  private async inspect(api: MemoryApi, sessionID?: string) {
    const status = await api.status({ sessionID })
    if (!status.state.enabled) throw new MemoryFailure(this.copy.t("memory.host.error.disabled"))
    await (this.input.reveal ?? ((root) => vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(root))))(
      status.root,
    )
    return status
  }

  // RPC failures carry a stable name and a redacted message, so the name picks the localized text.
  private failure(err: unknown, fallback: string) {
    if (err instanceof MemoryFailure) return err.message
    const type = err && typeof err === "object" && "type" in err && typeof err.type === "string" ? err.type : undefined
    const key = type ? ERRORS[type] : undefined
    if (key) return this.copy.t(key)
    return getErrorMessage(err) || fallback
  }
}

const ERRORS: Record<string, string> = {
  memory_disabled: "memory.host.error.disabled",
  memory_invalid_input: "memory.host.error.invalidInput",
  memory_root_error: "memory.host.error.root",
  memory_storage_error: "memory.host.error.storage",
  memory_corrupt_state: "memory.host.error.corrupt",
  memory_error: "memory.host.error.operation",
  "rpc.unavailable": "memory.host.error.unavailable",
}

/** The memory RPC of the server Location for `directory`. */
export function memoryApi(server: Pick<Manager, "get">, directory: string | undefined) {
  return async (): Promise<MemoryApi | undefined> => {
    if (!directory) return undefined
    const target = await server.get()
    const rpc = OpenCode.make({
      baseUrl: target.url,
      headers: { authorization: target.authorization },
      fetch: local,
    }).rpc(KiloMemoryRpc.Definition)
    const at = { location: { directory } }
    return {
      status: (input) => rpc.status(input, at),
      show: () => rpc.show({}, at),
      enable: () => rpc.enable({}, at),
      disable: () => rpc.disable({}, at),
      configure: (input) => rpc.configure(input, at),
      rebuild: () => rpc.rebuild({}, at),
      remember: (input) => rpc.remember(input, at),
      correct: (input) => rpc.correct(input, at),
      forget: (input) => rpc.forget(input, at),
      purge: () => rpc.purge({ confirm: true }, at),
    }
  }
}
