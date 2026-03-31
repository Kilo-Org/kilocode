interface ErrorLike {
  message?: unknown
  status?: unknown
  data?: unknown
  body?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getText(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim()
    return text || undefined
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  return undefined
}

function getMessage(value: unknown) {
  if (!isObject(value)) return undefined
  return getText((value as ErrorLike).message)
}

function getStatus(value: unknown) {
  if (!isObject(value)) return undefined
  const status = (value as ErrorLike).status
  return typeof status === "number" ? String(status) : getText(status)
}

function getBody(value: unknown) {
  if (!isObject(value)) return undefined

  const body = (value as ErrorLike).body
  const text = getText(body)
  if (text) return text

  if (isObject(body)) {
    const msg = getMessage(body)
    if (msg) return msg
  }

  return undefined
}

function getData(value: unknown) {
  if (!isObject(value)) return undefined

  const data = (value as ErrorLike).data
  const text = getText(data)
  if (text) return text

  if (isObject(data)) {
    const msg = getMessage(data)
    if (msg) return msg
  }

  return undefined
}

export function getMigrationErrorMessage(err: unknown) {
  const message = getMessage(err)
  if (message) return message

  const body = getBody(err)
  if (body) return body

  const data = getData(err)
  if (data) return data

  const status = getStatus(err)
  if (status) return `Request failed (${status})`

  const text = getText(err)
  if (text) return text

  return "Unknown migration error"
}
