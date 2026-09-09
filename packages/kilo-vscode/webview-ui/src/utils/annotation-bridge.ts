import type { Annotation, AnnotationReply, AnnotationRequest } from "../../../src/shared/annotations"

type Action = AnnotationRequest extends infer Request
  ? Request extends AnnotationRequest
    ? Omit<Request, "type" | "requestID">
    : never
  : never

export function createAnnotationBridge(options: {
  postMessage: (message: AnnotationRequest) => void
  onMessage: (handler: (message: AnnotationReply | { type: string }) => void) => () => void
  changed?: (message: Extract<AnnotationReply, { type: "annotationRecords" }>) => void
  error?: (error: Error) => void
  timeout?: number
}) {
  const pending = new Map<
    string,
    {
      sessionID: string
      resolve: (items: Annotation[]) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  const unsubscribe = options.onMessage((input) => {
    if (input.type !== "annotationRecords" && input.type !== "annotationError") return
    const message = input as AnnotationReply
    const request = message.requestID ? pending.get(message.requestID) : undefined
    if (request && request.sessionID !== message.sessionID) return
    if (request) {
      clearTimeout(request.timer)
      pending.delete(message.requestID!)
    }
    if (message.type === "annotationError") {
      const error = new Error(message.error)
      if (request) request.reject(error)
      else if (!message.requestID) options.error?.(error)
      return
    }
    if (message.items.some((item) => item.sessionID !== message.sessionID)) {
      request?.reject(new Error("Annotation source scope mismatch."))
      return
    }
    options.changed?.(message)
    request?.resolve(message.items)
  })
  const request = (action: Action) => {
    if (pending.size >= 100) return Promise.reject(new Error("Too many pending annotation saves. Wait and retry."))
    const requestID = crypto.randomUUID()
    const { promise, resolve, reject } = Promise.withResolvers<Annotation[]>()
    const timer = setTimeout(() => {
      pending.delete(requestID)
      reject(
        new Error("Annotation storage did not respond. Your draft is preserved; retry to recover the same number."),
      )
    }, options.timeout ?? 15_000)
    pending.set(requestID, { sessionID: action.sessionID, resolve, reject, timer })
    try {
      options.postMessage({ type: "annotationRequest", requestID, ...action })
    } catch (error) {
      clearTimeout(timer)
      pending.delete(requestID)
      reject(error instanceof Error ? error : new Error("Annotation request could not be sent."))
    }
    return promise
  }
  return {
    load: (sessionID: string) => request({ action: "load", sessionID }),
    save: async (annotation: Annotation) => {
      const items = await request({ action: "save", sessionID: annotation.sessionID, annotation })
      const saved = items.find((item) => item.id === annotation.id)
      if (!saved?.number) throw new Error("Annotation storage did not return its source number.")
      return saved
    },
    remove: (sessionID: string, ids: string[]) => request({ action: "delete", sessionID, ids }),
    dispose: () => {
      unsubscribe()
      for (const request of pending.values()) {
        clearTimeout(request.timer)
        request.reject(new Error("Annotation view closed. Retry from the preserved draft."))
      }
      pending.clear()
    },
  }
}
