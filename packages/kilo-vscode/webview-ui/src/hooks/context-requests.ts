import { createSignal } from "solid-js"

type Pending = {
  resolve: (content: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export function createContextRequests(prefix: string, timeout: number, expired: string) {
  const [pending, setPending] = createSignal(false)
  const requests = new Map<string, Pending>()
  let counter = 0

  const settle = (id: string, run: (req: Pending) => void) => {
    const req = requests.get(id)
    if (!req) return
    clearTimeout(req.timer)
    requests.delete(id)
    setPending(requests.size > 0)
    run(req)
  }

  const request = (send: (id: string) => void) => {
    const id = `${prefix}-${++counter}`
    const deferred = Promise.withResolvers<string>()
    const timer = setTimeout(() => {
      settle(id, (req) => req.reject(new Error(expired)))
    }, timeout)
    requests.set(id, { resolve: deferred.resolve, reject: deferred.reject, timer })
    setPending(true)
    try {
      send(id)
    } catch (err) {
      deferred.reject(err)
    }
    return deferred.promise
  }

  const dispose = (message: string, reset = false) => {
    for (const req of requests.values()) {
      clearTimeout(req.timer)
      req.reject(new Error(message))
    }
    requests.clear()
    if (reset) setPending(false)
  }

  return { pending, settle, request, dispose }
}
