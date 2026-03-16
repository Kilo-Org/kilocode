// kilocode_change - new file
import { BashArity } from "@/permission/arity"

/**
 * Generates hierarchical always-patterns for a bash command and adds them
 * directly to the provided Set.
 *
 * Given `["npm", "install", "lodash"]` with text `"npm install lodash"`,
 * adds: `"npm *"`, `"npm install *"`, `"npm install lodash"`.
 *
 */
export namespace BashHierarchy {
  export function addAll(target: Set<string>, command: string[], text: string) {
    const prefix = BashArity.prefix(command)

    // Base wildcard: "npm *"
    if (command[0]) target.add(command[0] + " *")

    // Intermediate levels from arity: "npm install *", "npm run dev *", etc.
    for (let i = 2; i <= prefix.length; i++) {
      target.add(prefix.slice(0, i).join(" ") + " *")
    }

    // Exact command text: "npm install lodash"
    target.add(text)
  }
}
