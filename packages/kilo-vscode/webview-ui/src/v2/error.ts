// What the chat shows when something fails. The client reports transport reasons in its own words
// ("UnexpectedStatus: 408") and a provider can wrap its rejection in serialized JSON; the alert says
// what happened in a sentence, and the technical text moves behind its details disclosure.

/** A message for an alert, plus the technical text behind its details disclosure. */
export interface Failure {
  readonly message: string
  readonly details?: string | undefined
}

const connectionFailed = "Couldn't reach the Kilo server. Check that it is running, then try again."
const unreadableResponse = "The Kilo server sent a response this client couldn't read."

export function toFailure(error: unknown): Failure {
  const message = readableMessage(error)
  const details = technicalDetails(error)
  if (details === undefined || details === message) return { message }
  return { message, details }
}

/** The readable sentence for an error, or for a message the server already recorded. */
export function readableMessage(error: unknown): string {
  return readable(message(error))
}

/** The best message an unknown error value carries, before any rewriting. */
export function message(error: unknown): string {
  if (error === undefined || error === null) return "unknown error"
  if (error instanceof Error) return error.message || error.name
  if (typeof error === "string") return error
  if (isRecord(error)) {
    const carried =
      text(error.message) ??
      text(error.error) ??
      (isRecord(error.error) ? text(error.error.message) : undefined) ??
      (isRecord(error.data) ? text(error.data.message) : undefined)
    if (carried !== undefined) return carried
  }
  return serialize(error) ?? "unknown error"
}

// The client names its failure reason for the wire, and a provider can report its rejection as a JSON
// envelope inside the message; both reach here as text, so they are rewritten into a sentence.
function readable(message: string) {
  if (/^Transport(?::|$)/.test(message)) return connectionFailed
  const status = /^UnexpectedStatus(?::\s*(\d{3}))?/.exec(message)
  if (status) return statusMessage(status[1] === undefined ? undefined : Number(status[1]))
  if (/^(?:UnsupportedContentType|MalformedResponse|SseEventTooLarge)(?::|$)/.test(message)) return unreadableResponse
  return unwrap(message)
}

function statusMessage(status: number | undefined) {
  if (status === undefined) return "The Kilo server returned an unexpected status."
  if (status === 408) return "The Kilo server took too long to respond. Try again."
  if (status === 429) return "The Kilo server is busy right now. Try again in a moment."
  if (status >= 500) return "The Kilo server is having trouble right now. Try again in a moment."
  return `The Kilo server returned an unexpected status (${status}).`
}

// A provider can report its rejection as a JSON envelope inside the message, and the hierarchy above
// the server error can repeat it another level down; show the sentence inside instead of the envelope.
function unwrap(message: string) {
  const text = message.replace(/^Error:\s*/, "").trim()
  const parsed = parse(text)
  if (parsed !== undefined) return embedded(parsed) ?? message
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) return message
  return embedded(parse(text.slice(start, end + 1))) ?? message
}

function embedded(value: unknown): string | undefined {
  if (typeof value === "string") return text(value)
  if (!isRecord(value)) return undefined
  if (isRecord(value.error)) return errorDetail(value.error) ?? text(value.message)
  return text(value.message) ?? text(value.error)
}

function errorDetail(error: Record<string, unknown>) {
  const type = text(error.type)
  const detail = text(error.message)
  if (type && detail) return `${type}: ${detail}`
  return detail ?? text(error.code)
}

function technicalDetails(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined
  if (error instanceof Error) {
    const cause = error.cause === undefined ? undefined : serialize(error.cause)
    return [error.stack ?? `${error.name}: ${error.message}`, ...(cause ? [`Caused by: ${cause}`] : [])].join("\n")
  }
  return serialize(error) ?? text(error)
}

function serialize(value: unknown) {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    // A circular or otherwise unserializable value still has to name itself in the details.
    return undefined
  }
}

function parse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
