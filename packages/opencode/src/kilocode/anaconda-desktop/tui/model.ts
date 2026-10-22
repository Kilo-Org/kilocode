import type { AnacondaDesktopStatus } from "@kilocode/sdk/v2"
import { DOWNLOAD_URL } from "../domain"

export type ReadyStatus = Extract<AnacondaDesktopStatus, { type: "ready" }>

export type SetupState = {
  status?: AnacondaDesktopStatus
  phase: "idle" | "checking" | "opening" | "syncing"
  error?: string
}

type Api = {
  status(signal: AbortSignal): Promise<AnacondaDesktopStatus>
  open(signal: AbortSignal): Promise<void>
  sync(acknowledge: boolean, signal: AbortSignal): Promise<ReadyStatus>
}

type Options = {
  api: Api
  synced(status: ReadyStatus, signal: AbortSignal): Promise<void> | void
  change?(state: SetupState): void
}

function message(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return "The Anaconda Desktop operation failed."
}

export function complete(input: { pick(): void; signal?: AbortSignal }) {
  if (input.signal?.aborted) return false
  input.pick()
  return true
}

export function createSetupController(options: Options) {
  let state: SetupState = { phase: "idle" }
  let active = false
  let busy = false
  let abort: AbortController | undefined

  const update = (next: Partial<SetupState>) => {
    state = { ...state, ...next }
    options.change?.(state)
  }

  const operate = async (phase: SetupState["phase"], task: (signal: AbortSignal) => Promise<void>) => {
    if (!active || busy) return false
    busy = true
    const ctrl = new AbortController()
    abort = ctrl
    update({ phase, error: undefined })

    try {
      await task(ctrl.signal)
      if (!active || ctrl.signal.aborted) return false
      update({ phase: "idle", error: undefined })
      return true
    } catch (error) {
      if (!active || ctrl.signal.aborted) return false
      update({ phase: "idle", error: message(error) })
      return false
    } finally {
      if (abort === ctrl) abort = undefined
      busy = false
    }
  }

  const check = () =>
    operate("checking", async (signal) => {
      const status = await options.api.status(signal)
      if (!signal.aborted) update({ status })
    })

  return {
    start() {
      if (active) return
      active = true
      void check()
    },
    stop() {
      if (!active) return
      active = false
      abort?.abort()
      abort = undefined
    },
    refresh: check,
    open() {
      return operate("opening", (signal) => options.api.open(signal))
    },
    connect() {
      const status = state.status
      if (status?.type !== "ready") return Promise.resolve(false)
      return operate("syncing", async (signal) => {
        const synced = await options.api.sync(status.toolcall !== "supported", signal)
        if (active && !signal.aborted) await options.synced(synced, signal)
      })
    },
    snapshot() {
      return state
    },
  }
}

export type SetupAction = "download" | "open" | "connect" | "refresh"

export type SetupView = {
  title: string
  lines: string[]
  actions: Array<{ key: string; label: string; type: SetupAction }>
  downloadURL?: string
  warning?: boolean
}

const refresh = { key: "r", label: "check again", type: "refresh" } as const
const desktop = { key: "o", label: "open Anaconda Desktop", type: "open" } as const

function ready(status: Extract<AnacondaDesktopStatus, { type: "ready" }>): SetupView {
  const models = status.models.map((model) => model.name).join(", ")
  const server = status.serverName ? `${status.serverName} (${status.serverID})` : status.serverID
  const context = status.context > 0 ? `${status.context.toLocaleString()} tokens` : "not reported"
  const base = [`Server: ${server}`, `Models: ${models}`, `Context: ${context}`]

  if (status.toolcall === "supported") {
    return {
      title: "Anaconda Desktop is ready",
      lines: [...base, "Tool calling: supported. Connect to import this server into Kilo."],
      actions: [{ key: "c", label: "connect / refresh now", type: "connect" }, desktop, refresh],
    }
  }

  const capability = status.toolcall === "unsupported" ? "not supported" : "unknown"
  return {
    title: "Limited tool support",
    lines: [
      ...base,
      `Tool calling: ${capability}.`,
      "Coding-agent actions may fail. Continue only if you accept these limitations.",
    ],
    actions: [{ key: "c", label: "connect anyway", type: "connect" }, desktop, refresh],
    warning: true,
  }
}

export function setupView(status?: AnacondaDesktopStatus): SetupView {
  if (!status) {
    return {
      title: "Connect Anaconda Desktop",
      lines: ["Checking this machine for Anaconda Desktop..."],
      actions: [refresh],
    }
  }

  switch (status.type) {
    case "unsupported-platform":
      return {
        title: "Platform not supported",
        lines: [
          `Anaconda Desktop cannot be connected on ${status.platform}.`,
          "Local setup is supported on macOS, Windows, and Linux.",
        ],
        actions: [refresh],
      }
    case "not-installed":
      return {
        title: "Install Anaconda Desktop",
        lines: ["Anaconda Desktop was not found on this machine.", "Download and install it, then check again."],
        actions: [{ key: "d", label: "open official download page", type: "download" }, refresh],
        downloadURL: DOWNLOAD_URL,
      }
    case "not-running":
      return {
        title: "Start Anaconda Desktop",
        lines: [
          "Anaconda Desktop is installed but is not running.",
          "Open it here, then choose check again.",
        ],
        actions: [desktop, refresh],
      }
    case "invalid-config": {
      const reason = {
        missing: "Desktop has not created its local configuration yet.",
        malformed: "Desktop's local configuration is malformed.",
        "missing-key": "Desktop's management credential is missing.",
        "invalid-port": "Desktop's management port is invalid.",
      }[status.reason]
      return {
        title: "Finish Desktop setup",
        lines: [reason, "Open Anaconda Desktop and finish setup or restart the app."],
        actions: [desktop, refresh],
      }
    }
    case "signed-out":
      return {
        title: "Sign in to Anaconda Desktop",
        lines: ["No saved Anaconda Desktop sign-in was found.", "Open Desktop and sign in, then choose check again."],
        actions: [desktop, refresh],
      }
    case "management-unauthorized":
      return {
        title: "Reconnect Anaconda Desktop",
        lines: [
          "Desktop rejected its local management credential.",
          "Open Desktop, sign in again if needed, and restart it.",
        ],
        actions: [desktop, refresh],
      }
    case "management-unavailable":
      return {
        title: "Anaconda Desktop is unavailable",
        lines: [
          status.reason === "timeout"
            ? "Desktop did not respond before the local request timed out."
            : "Desktop returned an unexpected local response.",
          "Open or restart Desktop, then choose check again.",
        ],
        actions: [desktop, refresh],
      }
    case "no-downloaded-model":
      return {
        title: "Download a text-generation model",
        lines: [
          "No downloaded model is available in Anaconda Desktop.",
          "Open Desktop and download a text-generation model.",
        ],
        actions: [desktop, refresh],
      }
    case "no-running-server":
      return {
        title: "Start a model server",
        lines: [
          `${status.downloadedModels} downloaded model${status.downloadedModels === 1 ? " is" : "s are"} available.`,
          "In Desktop, start a model server. Models with tool calling support are strongly recommended.",
        ],
        actions: [desktop, refresh],
      }
    case "inference-unhealthy":
      return {
        title: "Model server is not healthy",
        lines: [
          `Desktop reports server ${status.serverID}, but it is not ready for chat completions.`,
          "Open Desktop and restart or inspect the server.",
        ],
        actions: [desktop, refresh],
      }
    case "ready":
      return ready(status)
  }
}
