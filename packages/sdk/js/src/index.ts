export * from "./client.js"
export * from "./server.js"

import { createKiloClient } from "./client.js"
import { createKiloServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createKilo(options?: ServerOptions) {
  const server = await createKiloServer({
    ...options,
  })

  const client = createKiloClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
