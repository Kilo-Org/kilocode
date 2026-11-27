// Voice input for the v2 extension host: microphone capture, the Gateway catalog and transcription, and a direct
// OpenAI-compatible endpoint. The webview never sees the server password or the audio bytes.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import type { AgentManagerConnection } from "../agent-manager/connection"
import { samePath } from "../agent-manager/project/paths"
import { applyConfigEdits, configWriteQueue } from "../config-file-edit"
import type { ToHost, ToWebview, SpeechToTextStatus } from "../protocol"
import type { Manager } from "../server"
import type { Target } from "../relay"
import { fetchGatewayModels, isGatewaySignedIn, transcriptionModels } from "./catalog"
import { cancelSpeechCapture, prewarmSpeechCapture, startSpeechCapture, stopSpeechCapture } from "./capture"
import { globalSpeechWriteTarget, readSpeechSettings } from "./config"
import { DEFAULT_SPEECH_TO_TEXT_MODEL, type SpeechToTextModelDef } from "./models"
import { resolveSpeechStatus } from "./status"
import { transcribeSpeech } from "./transcribe"

type Start = { type: "speechToTextStart"; requestId: string; model: string; language?: string }
type Stop = { type: "speechToTextStop"; requestId: string }
type Cancel = { type: "speechToTextCancel"; requestId: string }
type Save = { type: "speechToTextSave"; requestId: string; key: "base_url" | "api_key" | "model"; value: string }

const CATALOG_TTL = 60_000
const GATEWAY_ORG_EVENT = `rpc.${KiloGatewayRpc.Definition.id}.organization`

export type SpeechAuthSubscribe = (directory: string, listener: () => void) => () => void

/**
 * Shares one subscription on the host SSE connection across every open webview that renders speech-to-text UI,
 * notifying listeners when Kilo Gateway auth, organization, or provider state changes.
 */
export function createSpeechAuthWatcher(connection: Pick<AgentManagerConnection, "onEvent" | "onState" | "state">) {
  const listeners = new Set<{ directory: string; notify: () => void }>()
  let needsRefresh = connection.state() !== "connected"

  const notifyAll = () => {
    for (const entry of [...listeners]) entry.notify()
  }

  const unsubEvent = connection.onEvent((event) => {
    if (event.type === "credential.switched") {
      const id =
        "integrationID" in event.data && typeof event.data.integrationID === "string"
          ? event.data.integrationID
          : undefined
      if (id && id !== "kilo") return
      notifyAll()
      return
    }
    if (event.type === GATEWAY_ORG_EVENT) {
      notifyAll()
      return
    }
    if (event.type === "provider.updated") {
      const dir = event.location?.directory
      for (const entry of [...listeners]) {
        if (!dir || samePath(normalizeDir(entry.directory), normalizeDir(dir))) entry.notify()
      }
    }
  })

  const unsubState = connection.onState((status) => {
    if (status !== "connected") {
      needsRefresh = true
      return
    }
    if (!needsRefresh) return
    needsRefresh = false
    notifyAll()
  })

  return {
    subscribe: ((directory, notify) => {
      const entry = { directory, notify }
      listeners.add(entry)
      return () => void listeners.delete(entry)
    }) satisfies SpeechAuthSubscribe,
    dispose() {
      unsubEvent()
      unsubState()
      listeners.clear()
    },
  }
}

type Dependencies = {
  start: typeof startSpeechCapture
  stop: typeof stopSpeechCapture
  cancel: typeof cancelSpeechCapture
  prewarm: typeof prewarmSpeechCapture
  readSettings: typeof readSpeechSettings
  writeTarget: typeof globalSpeechWriteTarget
  fetchModels: typeof fetchGatewayModels
  signedIn: typeof isGatewaySignedIn
  staticModels: typeof transcriptionModels
  transcribe: typeof transcribeSpeech
}

export function createSpeechToTextHost(input: {
  server: Manager
  directory: string
  remote: boolean
  profile: string
  /** Settings sends the custom key back to its own view; the composer never receives it. */
  secrets?: boolean
  /** Shared host auth subscription: invalidates cached Gateway models and pushes updated status on changes. */
  onAuthChange?: (listener: () => void) => () => void
  deps?: Partial<Dependencies>
  post: (message: ToWebview) => void
}) {
  const deps: Dependencies = {
    start: startSpeechCapture,
    stop: stopSpeechCapture,
    cancel: cancelSpeechCapture,
    prewarm: prewarmSpeechCapture,
    readSettings: readSpeechSettings,
    writeTarget: globalSpeechWriteTarget,
    fetchModels: fetchGatewayModels,
    signedIn: isGatewaySignedIn,
    staticModels: transcriptionModels,
    transcribe: transcribeSpeech,
    ...input.deps,
  }
  const { remote, profile } = input
  const aborts = new Map<string, AbortController>()
  const cancelled = new Set<string>()
  const starts = new Map<string, Promise<boolean>>()
  const stopping = new Set<string>()
  let catalog: { server: string; signedIn: boolean; at: number; models: SpeechToTextModelDef[] } | undefined
  let catalogVersion = 0
  let active: string | undefined
  let disposed = false

  const target = async (): Promise<Target> => input.server.get()

  const invalidateCatalog = () => {
    catalog = undefined
    catalogVersion++
  }

  const gatewayCatalog = async (target: Target, signedIn: boolean, signal?: AbortSignal) => {
    if (
      catalog &&
      catalog.server === target.url &&
      catalog.signedIn === signedIn &&
      Date.now() - catalog.at < CATALOG_TTL
    )
      return { models: catalog.models, error: undefined }
    const version = catalogVersion
    const result = await deps.fetchModels(target, input.directory, signal)
    // Do not cache a failure: the next status request retries instead of showing the static list for a minute.
    if (!result.ok) {
      if (version === catalogVersion) catalog = undefined
      return { models: [...deps.staticModels()], error: result.error }
    }
    if (version === catalogVersion) catalog = { server: target.url, signedIn, at: Date.now(), models: result.models }
    return { models: result.models, error: undefined }
  }

  const status = async (): Promise<SpeechToTextStatus> => {
    const settings = await deps.readSettings({ env: process.env, profile })
    if (settings.baseUrl)
      return resolveSpeechStatus({ settings, remote, signedIn: false, models: [], secrets: input.secrets })
    const server = await target()
    const signedIn = await deps.signedIn(server, input.directory)
    const found = await gatewayCatalog(server, signedIn)
    return resolveSpeechStatus({
      settings,
      remote,
      signedIn,
      models: found.models,
      secrets: input.secrets,
      ...(found.error ? { catalogError: found.error } : {}),
    })
  }

  let statusSeq = 0
  const postStatus = () => {
    if (disposed) return
    const seq = ++statusSeq
    void status().then(
      (value) => {
        if (!disposed && seq === statusSeq) input.post({ type: "speechToTextConfigLoaded", status: value })
      },
      (err: unknown) => {
        console.warn("[Kilo v2] Speech status failed", err)
        if (!disposed && seq === statusSeq) input.post({ type: "speechToTextConfigLoaded", status: offline(remote) })
      },
    )
  }

  const stopAuth = input.onAuthChange?.(() => {
    invalidateCatalog()
    postStatus()
  })

  const prewarm = () => {
    void deps.prewarm().catch((err: unknown) => console.warn("[Kilo v2] Speech capture prewarm failed:", err))
  }

  const start = (message: Start) => {
    active = message.requestId
    const task = deps.start({
      requestId: message.requestId,
      model: message.model || "",
      language: message.language,
    })
    starts.set(message.requestId, task)

    void task
      .then((started) => {
        starts.delete(message.requestId)
        if (!started) {
          if (active === message.requestId) active = undefined
          return
        }
        if (stopping.has(message.requestId) || cancelled.has(message.requestId)) return
        input.post({ type: "speechToTextStarted", requestId: message.requestId })
      })
      .catch((err: unknown) => {
        starts.delete(message.requestId)
        stopping.delete(message.requestId)
        if (active === message.requestId) active = undefined
        if (cancelled.delete(message.requestId)) return
        input.post({ type: "speechToTextError", error: messageOf(err, "Speech recording failed"), requestId: message.requestId })
      })
  }

  const stop = (message: Stop) => {
    if (stopping.has(message.requestId)) return
    const ctrl = new AbortController()
    const ready = starts.get(message.requestId)?.catch(() => false) ?? Promise.resolve(true)
    aborts.set(message.requestId, ctrl)
    stopping.add(message.requestId)

    void ready
      .then(async (started) => {
        if (!started) return undefined
        const audio = await deps.stop(message.requestId)
        const settings = await deps.readSettings({ env: process.env, profile })
        const server = await target()
        return deps.transcribe({ server, directory: input.directory, settings, audio, signal: ctrl.signal })
      })
      .then((result) => {
        aborts.delete(message.requestId)
        stopping.delete(message.requestId)
        if (active === message.requestId) active = undefined
        if (!result) return
        if (cancelled.delete(message.requestId)) return
        if (!result.ok && result.code === "cancelled") return
        if (result.ok) {
          input.post({ type: "speechToTextResult", text: result.text, requestId: message.requestId })
          return
        }
        if (result.code === "not_authenticated" || result.code === "unauthorized") {
          invalidateCatalog()
          postStatus()
        }
        input.post({
          type: "speechToTextError",
          error: result.error,
          ...(result.code ? { code: result.code } : {}),
          requestId: message.requestId,
        })
      })
      .catch((err: unknown) => {
        aborts.delete(message.requestId)
        stopping.delete(message.requestId)
        if (active === message.requestId) active = undefined
        if (cancelled.delete(message.requestId)) return
        input.post({ type: "speechToTextError", error: messageOf(err, "Speech to text request failed"), requestId: message.requestId })
      })
  }

  const cancel = (message: Cancel) => {
    if (active === message.requestId) active = undefined
    const ctrl = aborts.get(message.requestId)
    if (ctrl) {
      cancelled.add(message.requestId)
      stopping.delete(message.requestId)
      ctrl.abort()
      aborts.delete(message.requestId)
      input.post({ type: "speechToTextCancelled", requestId: message.requestId })
      return
    }

    const ready = starts.get(message.requestId)
    if (ready) {
      cancelled.add(message.requestId)
      stopping.delete(message.requestId)
      void ready
        .catch(() => false)
        .then((started) => (started ? deps.cancel(message.requestId) : undefined))
        .then(() => {
          cancelled.delete(message.requestId)
          input.post({ type: "speechToTextCancelled", requestId: message.requestId })
        })
        .catch((err: unknown) => {
          cancelled.delete(message.requestId)
          input.post({
            type: "speechToTextError",
            error: messageOf(err, "Speech recording cancellation failed"),
            requestId: message.requestId,
          })
        })
      return
    }

    void deps.cancel(message.requestId)
      .then(() => input.post({ type: "speechToTextCancelled", requestId: message.requestId }))
      .catch((err: unknown) =>
        input.post({
          type: "speechToTextError",
          error: messageOf(err, "Speech recording cancellation failed"),
          requestId: message.requestId,
        }),
      )
  }

  const save = (message: Save) => {
    configWriteQueue(async () => {
      const target = deps.writeTarget(process.env, profile)
      const existing = await readFile(target, "utf8").catch(() => "")
      const edits = [
        {
          path: ["experimental", `speech_to_text_${message.key}`],
          value: message.value.trim() || undefined,
        },
      ]
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, applyConfigEdits(existing, edits))
    })
      .then(() => {
        input.post({ type: "speechToTextSaved", requestId: message.requestId, ok: true })
        postStatus()
      })
      .catch((err: unknown) => {
        input.post({
          type: "speechToTextSaved",
          requestId: message.requestId,
          ok: false,
          error: messageOf(err, "Could not save the speech settings"),
        })
      })
  }

  /** Returns true when the message belongs to speech, so the webview handler needs one branch for both hosts. */
  const handle = (message: ToHost): boolean => {
    if (message.type === "speechToTextConfig") {
      postStatus()
      return true
    }
    if (message.type === "speechToTextPrewarm") {
      prewarm()
      return true
    }
    if (message.type === "speechToTextStart") {
      start(message)
      return true
    }
    if (message.type === "speechToTextStop") {
      stop(message)
      return true
    }
    if (message.type === "speechToTextCancel") {
      cancel(message)
      return true
    }
    if (message.type === "speechToTextSave") {
      save(message)
      return true
    }
    return false
  }

  return {
    handle,
    postStatus,
    invalidateCatalog,
    dispose: () => {
      disposed = true
      statusSeq++
      stopAuth?.()
      // A disposed webview cannot be relied on to send its cancel, so stop the microphone here. Capture the id,
      // because cancel() clears `active`.
      const current = active
      if (current) cancel({ type: "speechToTextCancel", requestId: current })
      for (const id of starts.keys()) {
        if (id !== current) cancel({ type: "speechToTextCancel", requestId: id })
      }
      aborts.forEach((ctrl) => ctrl.abort())
    },
  }
}

function normalizeDir(dir: string): string {
  const value = dir.replace(/\\/g, "/")
  if (/^[A-Za-z]:\/+$/u.test(value)) return `${value.slice(0, 2)}/`
  return value.replace(/\/+$/u, "") || "/"
}

function offline(remote: boolean): SpeechToTextStatus {
  return {
    enabled: false,
    remote,
    signedIn: false,
    source: "gateway",
    model: DEFAULT_SPEECH_TO_TEXT_MODEL.id,
    models: [...transcriptionModels()],
    settings: {},
  }
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}
