import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { SandboxPreference } from "../services/sandbox-preference"

export const SANDBOX_METADATA_KEY = "kilocode.sandbox"

export function sandboxMetadata(enabled: boolean, metadata?: Record<string, unknown>) {
  return {
    ...metadata,
    [SANDBOX_METADATA_KEY]: {
      enabled,
      version: 0,
    },
  }
}

export async function sandboxDefault(preference: SandboxPreference | undefined, client: KiloClient, directory: string) {
  await preference?.wait()
  const explicit = preference?.explicit()
  if (explicit !== undefined) return explicit
  const { data } = await client.config.get({ directory }, { throwOnError: true })
  return data.experimental?.sandbox === true
}

export async function sandboxSessionMetadata(
  preference: SandboxPreference | undefined,
  client: KiloClient,
  directory: string,
  metadata?: Record<string, unknown>,
) {
  return sandboxMetadata(await sandboxDefault(preference, client, directory), metadata)
}
