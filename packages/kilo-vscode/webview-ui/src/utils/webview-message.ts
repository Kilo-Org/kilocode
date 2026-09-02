type Message = Pick<MessageEvent, "origin" | "isTrusted">

type Target = Pick<Window, "origin" | "addEventListener" | "removeEventListener">

const local = new WeakSet<object>()

export function trusted(message: Message, origin: string): boolean {
  return origin !== "" && origin !== "null" && message.origin === origin && (message.isTrusted || local.has(message))
}

export function protect(target: Target = window): () => void {
  const listener = (event: MessageEvent) => {
    if (!trusted(event, target.origin)) event.stopImmediatePropagation()
  }
  target.addEventListener("message", listener, true)
  return () => target.removeEventListener("message", listener, true)
}

export function post(message: unknown, target: Pick<Window, "origin" | "dispatchEvent"> = window): void {
  const event = new MessageEvent("message", { data: message, origin: target.origin })
  local.add(event)
  try {
    target.dispatchEvent(event)
  } finally {
    local.delete(event)
  }
}
