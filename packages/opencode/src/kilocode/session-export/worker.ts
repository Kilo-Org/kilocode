import { Config } from "./config"
import { Chunker } from "./worker/chunks"
import { handleEvent } from "./worker/handlers"
import { Inbox } from "./worker/inbox"
import type { FromWorker, ToWorker } from "./worker/ipc"
import { Scrubber } from "./worker/scrub"
import { Storage } from "./worker/storage"

type Scope = {
  onmessage: (event: MessageEvent<ToWorker>) => void
  postMessage: (message: FromWorker | { kind: "test_event_count"; count: number }) => void
}

const scope = self as unknown as Scope

let storage: Storage | undefined
let chunker: Chunker | undefined
let scrubber: Scrubber | undefined
let inbox: Inbox | undefined
let draining = false

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
        } catch (err) {
          scope.postMessage({ kind: "telemetry", name: "session_export.handler_error", props: { message: String(err) } })
        }
      }
    }
  } finally {
    draining = false
  }
}

scope.onmessage = (event) => {
  const msg = event.data
  switch (msg.kind) {
    case "init":
      storage = new Storage(msg.dbPath)
      storage.migrate()
      chunker = new Chunker(storage, { chunkBytes: Config.chunkBytes })
      scrubber = new Scrubber()
      inbox = new Inbox({ capacityBytes: Config.ringBufferBytes })
      scope.postMessage({ kind: "ready" })
      return
    case "event": {
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
        storage?.close()
        storage = undefined
        scope.postMessage({ kind: "shutdown_done" })
      })()
      return
    case "network_reconnect":
      return
  }
}
