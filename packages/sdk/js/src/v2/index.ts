export * from "./client.js"
export * from "./server.js"

import { createKiloClient } from "./client.js"
import { createKiloServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createKilo(options?: ServerOptions) {
  const server = await createKiloServer({
    ...options,
  })

  // kilocode_change start - pass Basic Auth header so client can talk to password-protected server
  const auth = `Basic ${Buffer.from(`${process.env.KILO_SERVER_USERNAME ?? "kilo"}:${server.password}`).toString("base64")}`
  const client = createKiloClient({
    baseUrl: server.url,
    headers: { Authorization: auth },
  })
  // kilocode_change end

  return {
    client,
    server,
  }
}
