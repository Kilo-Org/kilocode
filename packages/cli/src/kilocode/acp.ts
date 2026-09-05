import { AgentSideConnection, ndJsonStream, type Agent, type AuthMethod } from "@agentclientprotocol/sdk"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import { ACP } from "../acp/agent"
import { AuthMethodID } from "../acp/service"
import { OPENCODE_VERSION } from "../version"

// Kilo's ACP bridge. The Kilo host is started, authenticated, and owned by the
// caller, which hands this process an endpoint through the environment; this
// entrypoint only translates stdio ACP traffic into public client calls. It
// never starts a standalone server, opens a store, or touches Core.
const url = required("KILO_ACP_SERVER_URL")
const username = process.env.KILO_ACP_SERVER_USERNAME ?? "opencode"
const password = required("KILO_ACP_SERVER_PASSWORD")
// The credential is needed once; drop it so nothing this process spawns inherits it.
delete process.env.KILO_ACP_SERVER_URL
delete process.env.KILO_ACP_SERVER_USERNAME
delete process.env.KILO_ACP_SERVER_PASSWORD

const client = OpenCode.make({
  baseUrl: url,
  headers: { authorization: `Basic ${btoa(`${username}:${password}`)}` },
})
// No `_meta["terminal-auth"]`: suggesting a login command Kilo cannot run would
// promise an authentication flow this bridge does not support. The Kilo host is
// already authenticated, so `authenticate` stays a no-op acknowledgement.
// Declared before the stdio await below, which suspends module evaluation for
// the process's lifetime.
const authMethod: AuthMethod = {
  id: AuthMethodID,
  name: "Kilo host credentials",
  description: "Kilo authenticates in its own host; this bridge needs no separate login",
}
const stream = ndJsonStream(
  new WritableStream<Uint8Array>({
    write: (chunk) =>
      new Promise<void>((resolve, reject) => {
        process.stdout.write(chunk, (error) => (error ? reject(error) : resolve()))
      }),
  }),
  new ReadableStream<Uint8Array>({
    start(controller) {
      process.stdin.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
      process.stdin.on("end", () => controller.close())
      process.stdin.on("error", (error) => controller.error(error))
    },
  }),
)
const connection = new AgentSideConnection((connection) => kilo(client, connection), stream)
const close = () => process.exit(0)
process.once("SIGINT", close)
process.once("SIGTERM", close)
process.stdin.resume()
await connection.closed
// EOF owns this stdio process. The Kilo endpoint belongs to the caller and keeps running.
process.exit(0)

// Upstream's agent reports itself as OpenCode and advertises an `opencode auth
// login` terminal flow. Kilo ships neither that binary nor an equivalent
// interactive login, so only the identity and the visible auth copy change; the
// protocol method id stays the same and the engine stays untouched.
function kilo(client: OpenCodeClient, connection: AgentSideConnection): Agent {
  const agent = ACP.create(client, connection)
  return {
    ...agent,
    initialize: async (params) => {
      const response = await agent.initialize(params)
      return {
        ...response,
        authMethods: response.authMethods?.map((method) => (method.id === AuthMethodID ? authMethod : method)),
        agentInfo: {
          ...response.agentInfo,
          name: "Kilo",
          title: "Kilo",
          version: response.agentInfo?.version ?? OPENCODE_VERSION,
        },
      }
    },
  }
}

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`The Kilo ACP bridge requires ${name}`)
  return value
}
