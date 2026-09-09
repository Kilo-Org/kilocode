import { watch, type FSWatcher } from "node:fs"
import type { AnnotationStore } from "./annotation-store"
import { type AnnotationReply, validAnnotationRequest } from "../shared/annotations"

export function createAnnotationHandler(options: {
  storage: () => string | undefined
  post: (message: AnnotationReply) => void
}) {
  let store: AnnotationStore | undefined
  let watcher: FSWatcher | undefined
  let disposed = false
  const sessions = new Set<string>()
  const revisions = new Map<string, number>()
  const error = (sessionID: string, cause: unknown, requestID?: string) => {
    if (disposed) return
    options.post({
      type: "annotationError",
      sessionID,
      requestID,
      error:
        cause instanceof SyntaxError
          ? "Annotation storage is invalid. Original data was not replaced."
          : cause instanceof Error
            ? cause.message
            : "Annotation storage failed. The draft has been preserved.",
    })
  }
  const storage = async () => {
    if (store) return store
    const directory = options.storage()
    if (!directory) throw new Error("Extension storage is unavailable. Annotation numbers were not saved.")
    const { AnnotationStore } = await import("./annotation-store")
    store ??= new AnnotationStore(directory)
    return store
  }
  const publish = (sessionID: string, result: Awaited<ReturnType<AnnotationStore["load"]>>, requestID?: string) => {
    if (disposed) return
    if (!requestID && revisions.get(sessionID) === result.revision) return
    revisions.set(sessionID, result.revision)
    options.post({ type: "annotationRecords", sessionID, requestID, ...result })
  }
  let refreshing = false
  let again = false
  const refresh = async () => {
    if (refreshing) {
      again = true
      return
    }
    refreshing = true
    try {
      do {
        again = false
        for (const id of sessions)
          await (
            await storage()
          )
            .load(id)
            .then((result) => publish(id, result))
            .catch((cause) => error(id, cause))
      } while (again && !disposed)
    } finally {
      refreshing = false
    }
  }
  const request = async (message: unknown) => {
    if (!validAnnotationRequest(message)) throw new Error("Invalid annotation storage request.")
    try {
      const store = await storage()
      const result =
        message.action === "save"
          ? await store.save(message.annotation)
          : message.action === "delete"
            ? await store.remove(message.sessionID, message.ids)
            : await store.load(message.sessionID)
      if (disposed) return
      // This is a live subscription limit, never an eviction of durable source records.
      if (sessions.size >= 64 && !sessions.has(message.sessionID)) sessions.delete(sessions.values().next().value!)
      sessions.add(message.sessionID)
      if (!watcher) {
        watcher = watch(store.directory, (_event, file) => {
          if (file?.toString() === "records-v1.json") void refresh()
        })
        watcher.on("error", (cause) => {
          for (const id of sessions) error(id, cause)
        })
      }
      publish(message.sessionID, result, message.requestID)
    } catch (cause) {
      error(message.sessionID, cause, message.requestID)
    }
  }
  return {
    handle: (message: { type: string }) => {
      if (message.type !== "annotationRequest") return false
      void request(message).catch((cause) => error("", cause))
      return true
    },
    deleteSession: async (id: string) => {
      try {
        publish(id, await (await storage()).deleteSession(id))
      } catch (cause) {
        error(id, cause)
      }
    },
    dispose: () => {
      disposed = true
      watcher?.close()
      sessions.clear()
    },
  }
}
