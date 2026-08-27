import type { KiloClient } from "@kilocode/sdk/v2/client"
import { configFeatures, serverFeatures } from "../features"
import { retry } from "../services/cli-backend/retry"
import type { ConfigTarget } from "./config-bindings"

type Client = Pick<KiloClient, "config" | "global" | "experimental">
type Settings = { maxCost: number; languageCommitMessage: string; multiProject: boolean }
export async function fetchSnapshot(client: Client, dir: string, settings: () => Settings) {
  const [{ data: config }, { data: global }, { data: overlay }, capabilities] = await Promise.all([
    retry(() => client.config.get({ directory: dir }, { throwOnError: true })),
    client.global.config.get({ throwOnError: true }),
    client.config.overlay({ directory: dir, scope: "project" }, { throwOnError: true }),
    retry(() => serverFeatures(client, dir)),
  ])
  return {
    config,
    globalConfig: global,
    targets: overlay?.targets as { global: ConfigTarget; project: ConfigTarget } | undefined,
    collections: overlay?.collections,
    settings: settings(),
    features: configFeatures(config, capabilities),
  }
}
