import type { KiloClient } from "@kilocode/sdk/v2/client"
import { configFeatures } from "../features"
import { retry } from "../services/cli-backend/retry"

type Client = Pick<KiloClient, "config" | "global">
type Settings = { maxCost: number; languageCommitMessage: string }
export async function fetchSnapshot(client: Client, dir: string, settings: () => Settings) {
  const [{ data: config }, { data: global }, { data: overlay }] = await Promise.all([
    retry(() => client.config.get({ directory: dir }, { throwOnError: true })),
    client.global.config.get({ throwOnError: true }),
    client.config.overlay({ directory: dir, scope: "project" }, { throwOnError: true }),
  ])
  return {
    config,
    globalConfig: global,
    projectConfig: overlay?.project,
    settings: settings(),
    features: configFeatures(config),
  }
}
