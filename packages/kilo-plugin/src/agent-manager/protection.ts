import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"

const STATE_FILE = "agent-manager.json"
const STATE_DIRECTORIES = [KiloConfigFiles.directories[0], ".kilo"]

export const MESSAGE =
  "Do not edit Agent Manager state directly. Use the agent_manager tool: call action=list to read section and session IDs, then call action=move with the returned IDs."

/**
 * Agent Manager state is persisted UI and recovery state. A direct edit can overwrite live sessions, so the
 * model-facing mutation tools must not touch it.
 */
export function assertMutablePath(filepath: string) {
  const parts = filepath.split(/[\\/]/)
  const file = parts.at(-1)
  const dir = parts.at(-2)
  if (file !== STATE_FILE || !STATE_DIRECTORIES.includes(dir ?? "")) return
  throw new Error(MESSAGE)
}
