import type { KiloClient } from "@kilocode/sdk/v2/client"

export async function hasGit(client: KiloClient): Promise<boolean> {
  return client.vcs
    .get()
    .then((r) => !!r.data?.branch)
    .catch(() => false)
}
