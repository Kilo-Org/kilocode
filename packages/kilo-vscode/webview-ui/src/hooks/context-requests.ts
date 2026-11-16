import { createSignal } from "solid-js"

type Pending = {
  resolve: (content: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// Every composer shares one counter: a composer that waits for a reply after it unmounted would otherwise hold the
// same request ID as the composer that replaced it, and the host broadcasts each reply to both.
let counter = 0

export function createContextRequests(prefix: string, timeout: number, expired: string) {
  const [pending, setPending] = createSignal(false)
  const requests = new Map<string, Pending>()
  let drained: (() => void) | undefined

  const settle = (id: string, run: (req: Pending) => void) => {
    const req = requests.get(id)
    if (!req) return
    clearTimeout(req.timer)
    requests.delete(id)
    setPending(requests.size > 0)
    run(req)
    if (requests.size > 0 || !drained) return
    const done = drained
    drained = undefined
    done()
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
      // Settle rather than only rejecting: the entry and its timer would otherwise keep `pending` true until the
      // timeout, and the composer gates Send on it.
      settle(id, (req) => req.reject(err instanceof Error ? err : new Error(String(err))))
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

  // A send that is resolving its mentions outlives the composer: a tab switch unmounts it, and cancelling the request
  // would drop the prompt. Keep listening until the open requests settle or time out, then run `done`.
  const drain = (done: () => void) => {
    if (requests.size === 0) return done()
    drained = done
  }

  return { pending, settle, request, dispose, drain }
}
