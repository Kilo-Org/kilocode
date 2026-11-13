// A local PostHog stand-in that records every batch the engine uploads.
export type Message = { event: string; distinct_id: string; properties: Record<string, unknown> }

export function posthog(status = 200) {
  const batches: Message[] = []
  const requests: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests.push(new URL(request.url).pathname)
      const body = (await request.json()) as { batch?: Message[] }
      if (status === 200) batches.push(...(body.batch ?? []))
      return Response.json({ status: 1 }, { status })
    },
  })
  return { url: server.url.origin, batches, requests, [Symbol.dispose]: () => server.stop(true) }
}
