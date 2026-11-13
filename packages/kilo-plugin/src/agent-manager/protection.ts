const STATE_FILE = "agent-manager.json"
// The v2 state stays in `.kilo2` with KILO_USE_RELEASE_CONFIG (packages/kilo-vscode/src/agent-manager/constants.ts).
const STATE_DIRECTORIES = [".kilo2", ".kilo"]

export const MESSAGE =
  "Do not edit Agent Manager state directly. Use the agent_manager tool: call action=list to read section and session IDs, then call action=move with the returned IDs."

/**
 * Agent Manager state is persisted UI and recovery state. A direct edit can overwrite live sessions, so the
 * model-facing mutation tools must not touch it.
 */
export function assertMutablePath(filepath: string) {
  const normalize = (value: string) =>
    process.platform === "win32" || process.platform === "darwin" ? value.toLowerCase() : value
  const parts = filepath.split(/[\\/]/)
  const file = parts.at(-1)
  const dir = parts.at(-2)
  if (normalize(file ?? "") !== normalize(STATE_FILE)) return
  if (!STATE_DIRECTORIES.some((name) => normalize(name) === normalize(dir ?? ""))) return
  throw new Error(MESSAGE)
}
