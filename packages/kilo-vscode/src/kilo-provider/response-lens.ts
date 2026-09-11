import type { KiloClient, ResponseLensExplainResponse, ResponseLensExplainError } from "@kilocode/sdk/v2"
import {
  validExplainBrieflyRequest,
  type ExplainBrieflyError,
  type ExplainBrieflyResult,
} from "../shared/response-lens"

const unavailable =
  "This CLI backend does not support Response Lens. Update the Kilo extension and its bundled CLI, then retry."

function responseLensClient(client: Pick<KiloClient, "responseLens"> | null) {
  if (!client) throw new Error("Not connected to the CLI backend. Reconnect Kilo, then retry.")
  if (!client.responseLens) throw new Error(unavailable)
  return client
}

export function responseLensDirectory(
  id: string,
  route: string | null | undefined,
  tracked: string | undefined,
  current: { id: string; directory: string } | null,
): string {
  if (route === null)
    throw new Error("This session's project is ambiguous. Reopen the original chat and select the text again.")
  const directory = route ?? tracked ?? (current?.id === id ? current.directory : undefined)
  if (!directory)
    throw new Error("The original chat directory is unavailable. Reopen that chat and select the text again.")
  return directory
}

function result({
  data,
  error,
  response,
}: {
  data?: ResponseLensExplainResponse
  error?: ResponseLensExplainError
  response?: Response
}) {
  if (response?.status === 404 || response?.status === 405) throw new Error(unavailable)
  if (!data)
    throw new Error(
      response?.status === 422 && error && "message" in error
        ? error.message
        : "Explanation failed. Check the selected model and provider connection, then retry.",
    )
  const tokens = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
  return {
    text: data.text,
    truncated: data.truncated,
    model: data.model,
    usage: data.usage
      ? {
          inputTokens: tokens(data.usage.inputTokens),
          outputTokens: tokens(data.usage.outputTokens),
          totalTokens: tokens(data.usage.totalTokens),
        }
      : undefined,
  }
}

export function createResponseLensHandler(options: {
  client: () => Pick<KiloClient, "responseLens"> | null
  directory: (sessionID: string) => string
  enabled: () => boolean
  confirmFile?: (file: string) => Promise<boolean>
  post: (message: ExplainBrieflyResult | ExplainBrieflyError) => void
}) {
  const requests = new Map<string, AbortController>()
  const cancel = (id?: string) => {
    for (const [key, controller] of requests) {
      if (id !== undefined && key !== id) continue
      requests.delete(key)
      controller.abort()
    }
  }
  const explain = async (message: unknown) => {
    const id = message && typeof message === "object" && "requestId" in message ? message.requestId : undefined
    if (typeof id !== "string" || !id || id.length > 512) return
    cancel()
    const controller = new AbortController()
    requests.set(id, controller)
    try {
      if (!validExplainBrieflyRequest(message))
        throw new Error("Invalid explanation request. Select up to 4,000 characters and retry.")
      if (!options.enabled()) throw new Error("Response Lens is disabled. Enable it in Kilo Settings > Display.")
      // Resolve once, before awaiting anything. Never use the later live pane directory.
      const directory = options.directory(message.sessionID)
      const client = responseLensClient(options.client())
      const { resolveReferences } = await import("./response-lens-references")
      const references = await resolveReferences({
        references: message.references ?? [],
        directory,
        text: message.text,
        context: message.context,
        signal: controller.signal,
        confirmFile: options.confirmFile,
      })
      if (requests.get(id) !== controller || controller.signal.aborted || !options.enabled()) return
      const reply = await client.responseLens.explain(
        { directory, text: message.text, level: message.level, model: message.model, context: references.context },
        { signal: controller.signal, throwOnError: false },
      )
      if (requests.get(id) !== controller) return
      options.post({
        type: "explainBrieflyResult",
        requestId: id,
        ...result(reply),
        ...(references.sources.length ? { sources: references.sources } : {}),
      })
    } catch (error) {
      if (requests.get(id) !== controller || controller.signal.aborted) return
      options.post({
        type: "explainBrieflyError",
        requestId: id,
        error:
          error instanceof Error
            ? error.message
            : "Explanation failed. Check the model and provider connection, then retry.",
      })
    } finally {
      if (requests.get(id) === controller) requests.delete(id)
    }
  }
  const handle = (message: { type: string; requestId?: unknown }) => {
    if (message.type === "explainBriefly") {
      void explain(message)
      return true
    }
    if (message.type !== "cancelExplainBriefly") return false
    if (typeof message.requestId === "string") cancel(message.requestId)
    return true
  }
  return { explain, cancel, handle }
}
