type Target = {
  post: (message: unknown) => PromiseLike<boolean>
  uri: (id: string) => string
}

const targets = new Set<Target>()

export function registerSoundWebview(post: Target["post"], uri: Target["uri"]) {
  const target: Target = { post, uri }
  let disposed = false

  return {
    ready() {
      if (disposed) return
      targets.delete(target)
      targets.add(target)
    },
    dispose() {
      disposed = true
      targets.delete(target)
    },
  }
}

export async function playWebviewSound(id: string) {
  const available = [...targets].reverse()

  for (const target of available) {
    const delivered = await Promise.resolve()
      .then(() => target.post({ type: "playNotificationSound", uri: target.uri(id) }))
      .then(
        (value) => value,
        (error) => {
          console.warn("[Kilo New] notification sound delivery failed", { error })
          return false
        },
      )
    if (delivered) return true
  }
  return false
}
