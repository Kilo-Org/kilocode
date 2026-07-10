type Target = {
  post: (message: unknown) => PromiseLike<boolean>
  uri: (id: string) => string
  ready: boolean
  order: number
}

const targets = new Set<Target>()
let order = 0

export function registerSoundWebview(post: Target["post"], uri: Target["uri"]) {
  const target: Target = { post, uri, ready: false, order: ++order }
  targets.add(target)

  return {
    ready() {
      target.ready = true
      target.order = ++order
    },
    dispose() {
      targets.delete(target)
    },
  }
}

export async function playWebviewSound(id: string) {
  const available = [...targets].filter((target) => target.ready).sort((a, b) => b.order - a.order)

  for (const target of available) {
    const message = { type: "playNotificationSound", uri: target.uri(id) }
    const delivered = await Promise.resolve()
      .then(() => target.post(message))
      .then(
        (value) => value,
        (error) => {
          console.warn("[Kilo New] notification sound message failed", { error })
          return false
        },
      )
    if (delivered) return true
  }
  return false
}
