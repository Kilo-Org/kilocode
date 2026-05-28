import type { KiloClient } from "@kilocode/sdk/v2/client"

export async function abortSession(input: { client: KiloClient; sessionID: string; dir: string }) {
  await input.client.session.abort({ sessionID: input.sessionID, directory: input.dir }, { throwOnError: true })
}
