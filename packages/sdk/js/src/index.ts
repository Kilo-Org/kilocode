export * from "./client.js"
export * from "./server.js"

import { createDevilClient } from "./client.js"
import { createDevilServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export async function createDevil(options?: ServerOptions) {
  const server = await createDevilServer({
    ...options,
  })

  const client = createDevilClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
