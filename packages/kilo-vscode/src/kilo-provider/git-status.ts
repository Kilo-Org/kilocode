import type { KiloClient } from "@kilocode/sdk-v1/v2/client"
import { exec } from "../util/process"

export async function hasGit(client: KiloClient, directory: string): Promise<boolean> {
  return Promise.resolve()
    .then(() => client.project.current({ directory }))
    .then((r) => r.data?.vcs === "git")
    .catch(() => false)
}

/** The Git work tree root of a directory, or undefined outside a repository. */
export async function gitRoot(directory: string): Promise<string | undefined> {
  return exec("git", ["rev-parse", "--show-toplevel"], { cwd: directory })
    .then((result) => result.stdout.trim() || undefined)
    .catch(() => undefined)
}
