import type { KiloClient } from "@kilocode/sdk/v2/client"

export async function hasGit(client: KiloClient, directory: string): Promise<boolean> {
  return client.project
    .current({ directory })
    .then((r) => r.data?.vcs === "git")
    .catch(() => false)
}
