// Voice input for the v2 extension host: microphone capture, the Gateway catalog and transcription, and a direct
// OpenAI-compatible endpoint. The webview never sees the server password or the audio bytes.
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { env as vscodeEnv, type ExtensionContext } from "vscode"
import { applyConfigEdits, configWriteQueue } from "../config-file-edit"
import type { ToHost, ToWebview, SpeechToTextStatus } from "../protocol"
import type { Manager } from "../server"
import { resolveKiloProfile } from "../settings-paths"
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

export function createSpeechToTextHost(input: {
  context: ExtensionContext
  server: Manager
  directory: string
  /** Settings sends the custom key back to its own view; the composer never receives it. */
  secrets?: boolean
  post: (message: ToWebview) => void
}) {
  const remote = !!vscodeEnv.remoteName
  const profile = resolveKiloProfile(input.context)
  const aborts = new Map<string, AbortController>()
  const cancelled = new Set<string>()
  const starts = new Map<string, Promise<boolean>>()
  const stopping = new Set<string>()
  let catalog: { server: string; at: number; models: SpeechToTextModelDef[] } | undefined
  let active: string | undefined

  const target = async (): Promise<Target> => input.server.get()

  const gatewayCatalog = async (target: Target, signal?: AbortSignal) => {
    if (catalog && catalog.server === target.url && Date.now() - catalog.at < CATALOG_TTL)
      return { models: catalog.models, error: undefined }
    const result = await fetchGatewayModels(target, input.directory, signal)
    // Do not cache a failure: the next status request retries instead of showing the static list for a minute.
    if (!result.ok) return { models: [...transcriptionModels()], error: result.error }
    catalog = { server: target.url, at: Date.now(), models: result.models }
    return { models: result.models, error: undefined }
  }

  const status = async (): Promise<SpeechToTextStatus> => {
    const settings = await readSpeechSettings({ env: process.env, profile })
    if (settings.baseUrl)
      return resolveSpeechStatus({ settings, remote, signedIn: false, models: [], secrets: input.secrets })
    const server = await target()
    const [signedIn, found] = await Promise.all([
      isGatewaySignedIn(server, input.directory),
      gatewayCatalog(server),
    ])
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
    const seq = ++statusSeq
    void status().then(
      (value) => {
        if (seq === statusSeq) input.post({ type: "speechToTextConfigLoaded", status: value })
      },
      (err: unknown) => {
        console.warn("[Kilo v2] Speech status failed", err)
        if (seq === statusSeq) input.post({ type: "speechToTextConfigLoaded", status: offline(remote) })
      },
    )
  }

  const prewarm = () => {
    void prewarmSpeechCapture().catch((err: unknown) => console.warn("[Kilo v2] Speech capture prewarm failed:", err))
  }

  const start = (message: Start) => {
    active = message.requestId
    const task = startSpeechCapture({
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
        const audio = await stopSpeechCapture(message.requestId)
        const settings = await readSpeechSettings({ env: process.env, profile })
        const server = await target()
        return transcribeSpeech({ server, directory: input.directory, settings, audio, signal: ctrl.signal })
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
        .then((started) => (started ? cancelSpeechCapture(message.requestId) : undefined))
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

    void cancelSpeechCapture(message.requestId)
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
      const target = globalSpeechWriteTarget(process.env, profile)
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
    dispose: () => {
      // A disposed webview cannot be relied on to send its cancel, so stop the microphone here.
      if (active) cancel({ type: "speechToTextCancel", requestId: active })
      for (const id of starts.keys()) {
        if (id !== active) cancel({ type: "speechToTextCancel", requestId: id })
      }
      aborts.forEach((ctrl) => ctrl.abort())
    },
  }
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
