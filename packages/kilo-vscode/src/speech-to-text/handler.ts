import { getErrorMessage } from "../kilo-provider-utils"
import { transcribeSpeech } from "./transcribe"
import { cancelSpeechCapture, startSpeechCapture, stopSpeechCapture } from "./capture"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"

type Msg = {
  requestId: string
  model?: string
  language?: string
}

type Post = (msg: unknown) => void

const aborts = new Map<string, AbortController>()
const cancelled = new Set<string>()
const starts = new Map<string, Promise<boolean>>()
const stopping = new Set<string>()

export function handleSpeechToTextStart(message: Msg, post: Post): void {
  const task = startSpeechCapture({
    requestId: message.requestId,
    model: message.model || "",
    language: message.language,
  })

  starts.set(message.requestId, task)

  void task
    .then((started) => {
      starts.delete(message.requestId)
      if (!started) return
      if (stopping.has(message.requestId) || cancelled.has(message.requestId)) return
      post({ type: "speechToTextStarted", requestId: message.requestId })
    })
    .catch((err: unknown) => {
      starts.delete(message.requestId)
      stopping.delete(message.requestId)
      if (cancelled.delete(message.requestId)) return
      post({
        type: "speechToTextError",
        error: getErrorMessage(err) || "Speech recording failed",
        requestId: message.requestId,
      })
    })
}

export function handleSpeechToTextStop(connection: KiloConnectionService, message: Msg, dir: string, post: Post): void {
  const ctrl = new AbortController()
  const ready = starts.get(message.requestId)?.catch(() => false) ?? Promise.resolve(true)
  aborts.set(message.requestId, ctrl)
  stopping.add(message.requestId)

  void ready
    .then((started) => {
      if (!started) return undefined
      return stopSpeechCapture(message.requestId).then((audio) => transcribeSpeech(connection, audio, dir, ctrl.signal))
    })
    .then((result) => {
      aborts.delete(message.requestId)
      stopping.delete(message.requestId)
      if (!result) return
      if (cancelled.delete(message.requestId)) return
      if (!result.ok && result.code === "cancelled") return
      if (result.ok) {
        post({ type: "speechToTextResult", text: result.text, requestId: message.requestId })
        return
      }
      post({ type: "speechToTextError", error: result.error, code: result.code, requestId: message.requestId })
    })
    .catch((err: unknown) => {
      aborts.delete(message.requestId)
      stopping.delete(message.requestId)
      if (cancelled.delete(message.requestId)) return
      post({
        type: "speechToTextError",
        error: getErrorMessage(err) || "Speech to text request failed",
        requestId: message.requestId,
      })
    })
}

export function handleSpeechToTextCancel(message: Msg, post: Post): void {
  const ctrl = aborts.get(message.requestId)
  if (ctrl) {
    cancelled.add(message.requestId)
    stopping.delete(message.requestId)
    ctrl.abort()
    aborts.delete(message.requestId)
    post({ type: "speechToTextCancelled", requestId: message.requestId })
    return
  }

  const ready = starts.get(message.requestId)
  if (ready) {
    cancelled.add(message.requestId)
    stopping.delete(message.requestId)
    void ready
      .catch(() => false)
      .then((started) => {
        if (!started) return undefined
        return cancelSpeechCapture(message.requestId)
      })
      .then(() => {
        cancelled.delete(message.requestId)
        post({ type: "speechToTextCancelled", requestId: message.requestId })
      })
      .catch((err: unknown) => {
        cancelled.delete(message.requestId)
        post({
          type: "speechToTextError",
          error: getErrorMessage(err) || "Speech recording cancellation failed",
          requestId: message.requestId,
        })
      })
    return
  }

  void cancelSpeechCapture(message.requestId)
    .then(() => {
      post({ type: "speechToTextCancelled", requestId: message.requestId })
    })
    .catch((err: unknown) => {
      post({
        type: "speechToTextError",
        error: getErrorMessage(err) || "Speech recording cancellation failed",
        requestId: message.requestId,
      })
    })
}
