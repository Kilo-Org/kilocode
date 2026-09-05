import { createClient } from "@kilocode/client"

export async function proveContract(baseUrl: string, password: string, directory: string) {
  const client = createClient({ baseUrl, headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` } })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  const events = client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
  try {
    const connected = await events.next()
    if (connected.done || connected.value.type !== "server.connected") throw new Error("SSE did not connect")
    const session = await client.session.create({ title: "Public contract proof", location: { directory } })
    const admitted = await client.session.prompt({ sessionID: session.id, text: "Admission-only proof", resume: false })
    const inbox = await client.session.inbox.list({ sessionID: session.id })
    const active = await client.session.active()
    while (true) {
      const next = await events.next()
      if (next.done) throw new Error("Event stream closed before admission was observed")
      const event = next.value
      if (
        event.type === "session.inbox.enqueued" &&
        event.data.sessionID === session.id &&
        event.data.inboxID === admitted.id
      ) {
        return { session, admitted, inbox, active, event }
      }
    }
  } finally {
    clearTimeout(timeout)
    controller.abort()
    await events.return?.(undefined).catch(() => undefined)
  }
}
