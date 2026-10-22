import type { KiloClient } from "@kilocode/sdk-v1/v2/client"
import { configFeatures } from "../features"
import { retry } from "../services/cli-backend/retry"

type Client = Pick<KiloClient, "config" | "global">
type Settings = Record<string, unknown>
export async function fetchSnapshot(client: Client, dir: string, settings: () => Settings) {
  const [{ data: config }, { data: global }] = await Promise.all([
    retry(() => client.config.get({ directory: dir }, { throwOnError: true })),
    client.global.config.get({ throwOnError: true }),
  ])
  // Settings are read-only on the Kilo v2 line: there are no config write targets until a Kilo settings RPC exists.
  return {
    config,
    globalConfig: global,
    targets: undefined as { global: { raw: unknown }; project: { raw: unknown } } | undefined,
    collections: undefined,
    settings: settings(),
    features: configFeatures(),
  }
}
