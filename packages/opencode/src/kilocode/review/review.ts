import { $ } from "bun"
import * as Log from "@opencode-ai/core/util/log"
import { Instance } from "@/kilocode/instance"

const log = Log.create({ service: "review" })

export namespace Review {
  /**
   * Detect base branch (main, master, dev, or develop)
   * Priority: main > master > dev > develop
   * Falls back to 'main' if none found
   * Keep this in sync with the default base list in local-review.txt.
   */
  export async function getBaseBranch(): Promise<string> {
    const candidates = ["main", "master", "dev", "develop"]

    // Check remote tracking branches first (usually more up-to-date)
    for (const branch of candidates) {
      const remoteCheck = await $`git show-ref --verify --quiet refs/remotes/origin/${branch}`
        .cwd(Instance.directory)
        .quiet()
        .nothrow()

      if (remoteCheck.exitCode === 0) {
        log.info("detected remote base branch", { branch: `origin/${branch}` })
        return `origin/${branch}`
      }
    }

    // Fall back to local branches if remote not found
    for (const branch of candidates) {
      const check = await $`git show-ref --verify --quiet refs/heads/${branch}`
        .cwd(Instance.directory)
        .quiet()
        .nothrow()

      if (check.exitCode === 0) {
        log.info("detected local base branch", { branch })
        return branch
      }
    }

    log.warn("no base branch found, defaulting to main")
    return "main"
  }
}
