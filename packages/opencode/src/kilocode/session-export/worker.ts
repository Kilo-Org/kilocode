import { Config } from "./config"
import { Chunker } from "./worker/chunks"
import { handleEvent } from "./worker/handlers"
import { Inbox } from "./worker/inbox"
import type { FromWorker, ToWorker } from "./worker/ipc"
import { Scrubber } from "./worker/scrub"
import { Storage } from "./worker/storage"
import { Uploader } from "./worker/uploader"
import { checkBufferCap } from "./worker/buffer-cap"
import { resolveEndpoint } from "./worker/endpoint"
import { parseMessage } from "./worker/validate"
import path from "node:path"

type Scope = {
  onmessage: (event: MessageEvent<unknown>) => void
  postMessage: (message: FromWorker | { kind: "test_event_count"; count: number }) => void
}

const scope = self as unknown as Scope

let storage: Storage | undefined
let chunker: Chunker | undefined
let scrubber: Scrubber | undefined
let inbox: Inbox | undefined
let uploader: Uploader | undefined
let draining = false
let tripped = false

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (inbox && storage && chunker && scrubber) {
      const batch = inbox.drainBatch(64)
      if (batch.length === 0) break
      for (const item of batch) {
        try {
          await handleEvent(item.envelope, {
            storage,
            chunker,
            scrubber,
            inlineThresholdBytes: Config.inlineThresholdBytes,
            maxPayloadBytes: Config.maxPayloadBytes,
          })
          uploader?.scheduleFlush("event_persisted")
        } catch (err) {
          scope.postMessage({
            kind: "telemetry",
            name: "session_export.handler_error",
            props: { message: String(err) },
          })
        }
      }
    }
  } finally {
    draining = false
  }
}

scope.onmessage = (event) => {
  const msg = parseMessage(event.data)
  if (!msg) {
    scope.postMessage({ kind: "telemetry", name: "session_export.invalid_worker_message" })
    return
  }
  switch (msg.kind) {
    case "init":
      storage = new Storage(msg.dbPath)
      storage.migrate()
      chunker = new Chunker(storage, { chunkBytes: Config.chunkBytes })
      scrubber = new Scrubber()
      inbox = new Inbox({ capacityBytes: Config.ringBufferBytes })
      uploader = new Uploader({
        storage,
        endpoint: resolveEndpoint({
          endpoint: msg.endpoint,
          env: process.env.KILO_SESSION_EXPORT_INGEST,
          allowCustom: msg.allowCustomEndpoint || process.env.KILO_SESSION_EXPORT_ALLOW_CUSTOM_INGEST === "1",
        }),
        fetch: globalThis.fetch,
        reportTelemetry: (item) => scope.postMessage(item),
        agentVersion: msg.agentVersion ?? "unknown",
        surface: msg.surface ?? "unknown",
        anonId: msg.anonId,
        anonIdPath: path.join(path.dirname(msg.dbPath), "telemetry-id"),
      })
      tripped = false
      scope.postMessage({ kind: "ready" })
      return
    case "event": {
      if (tripped) return
      if (!inbox) return
      const result = inbox.enqueue(msg.envelope.sessionId, msg.approxBytes, msg.envelope)
      if (!result.accepted && result.sessionFirstOverflow) {
        scope.postMessage({ kind: "pressure", sessionId: msg.envelope.sessionId })
      }
      void drain()
      return
    }
    case "test_event_count":
      void (async () => {
        await drain()
        const count = storage?.pendingEvents({ now: Date.now() + 1, limitBytes: 100_000_000 }).length ?? 0
        scope.postMessage({ kind: "test_event_count", count })
      })()
      return
    case "shutdown":
      void (async () => {
        await drain()
        await uploader?.flush("shutdown")
        uploader?.dispose()
        storage?.close()
        clearInterval(cap)
        storage = undefined
        chunker = undefined
        scrubber = undefined
        inbox = undefined
        uploader = undefined
        scope.postMessage({ kind: "shutdown_done" })
      })()
      return
    case "network_reconnect":
      uploader?.scheduleFlush("network_reconnect")
      return
  }
}

const cap = setInterval(() => {
  if (!storage || tripped) return
  const result = checkBufferCap(storage, { capacityBytes: Config.bufferCapBytes })
  if (!result.tripped) return
  tripped = true
  scope.postMessage({ kind: "telemetry", name: "session_export.buffer_overflow", props: { dbSize: result.dbSize } })
  scope.postMessage({ kind: "kill_switch", reason: "buffer_cap_50gb" })
}, 60_000)
cap.unref?.()
