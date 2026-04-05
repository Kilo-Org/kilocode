// kilocode_change - new file
import { BashArity } from "@/permission/arity"

/**
 * Generates hierarchical always-patterns for a bash command and adds them
 * directly to the provided Set.
 *
 * Given `["npm", "install", "lodash"]` with text `"npm install lodash"`,
 * adds: `"npm *"`, `"npm install *"`, `"npm install lodash"`.
 *
 * When the exact text matches the arity prefix (e.g. `"git branch"` with
 * prefix `["git", "branch"]`), the exact text is skipped because the
 * wildcard `"git branch *"` already covers it.
 */
export namespace BashHierarchy {
  export function addAll(target: Set<string>, command: string[], text: string) {
    const prefix = BashArity.prefix(command)

    // Add wildcard at each arity level: "git *", "git branch *", etc.
    for (let i = 1; i <= prefix.length; i++) {
      target.add(prefix.slice(0, i).join(" ") + " *")
    }

    // Add exact text only when it adds specificity beyond the arity prefix.
    // e.g. if text is "git log --oneline", add it; if it's only "git log",
    // no need to add it because arity already generates "git log *" as a prefix.
    if (text !== prefix.join(" ")) target.add(text)
  }
}
